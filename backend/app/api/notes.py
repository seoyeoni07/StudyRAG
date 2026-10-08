import base64
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import Note, NoteImage, NoteVersion, StudyGroup, StudyGroupMember
from ..db.session import SessionLocal

router = APIRouter(prefix="/notes", tags=["notes"])

_VERSION_INTERVAL_MINUTES = 5
_MAX_VERSIONS = 20


def _maybe_save_version(db: Session, note: Note, user_id: str) -> None:
    """5분 간격으로 최대 20개 버전 저장. 내용(ydoc 또는 content)이 없으면 스킵."""
    if not note.ydoc and not note.content:
        return
    last = (
        db.query(NoteVersion)
        .filter(NoteVersion.note_id == note.id)
        .order_by(NoteVersion.created_at.desc())
        .first()
    )
    if last and datetime.utcnow() - last.created_at < timedelta(minutes=_VERSION_INTERVAL_MINUTES):
        return
    db.add(NoteVersion(
        note_id=note.id, user_id=user_id, title=note.title or "",
        ydoc=note.ydoc, content=note.content or None,
    ))
    old_ids = [
        r.id for r in (
            db.query(NoteVersion.id)
            .filter(NoteVersion.note_id == note.id)
            .order_by(NoteVersion.created_at.desc())
            .offset(_MAX_VERSIONS)
            .all()
        )
    ]
    if old_ids:
        db.query(NoteVersion).filter(NoteVersion.id.in_(old_ids)).delete(synchronize_session=False)


def _can_see_versions(note: Note, user_id: str, db: Session) -> bool:
    """작성자, 그룹장 → 항상 True. 다른 멤버 → versions_public 여부."""
    if note.user_id == user_id:
        return True
    if note.group_id:
        g = db.query(StudyGroup).filter(StudyGroup.id == note.group_id).first()
        if g and g.owner_id == user_id:
            return True
        return bool(note.versions_public)
    return False  # 다른 사람의 개인 노트는 접근 불가 (404로 처리됨)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    return x_user_id


def _is_member(db: Session, group_id: str, user_id: str) -> bool:
    return db.query(StudyGroupMember).filter(
        StudyGroupMember.group_id == group_id, StudyGroupMember.user_id == user_id
    ).first() is not None


def _get_owned(db: Session, note_id: str, user_id: str) -> Note:
    """개인 노트는 작성자만, 그룹 노트는 그룹 멤버 누구나 접근할 수 있다."""
    note = db.query(Note).filter(Note.id == note_id).first()
    if note and (note.user_id == user_id if not note.group_id else _is_member(db, note.group_id, user_id)):
        return note
    raise HTTPException(404, "노트를 찾을 수 없습니다.")


def _merge_ydoc(stored_b64: str | None, incoming_b64: str) -> str:
    """두 Yjs 상태를 합친다. 업데이트는 교환·멱등이라 순서와 중복에 상관없이 안전하다."""
    from pycrdt import Doc

    doc = Doc()
    if stored_b64:
        doc.apply_update(base64.b64decode(stored_b64))
    doc.apply_update(base64.b64decode(incoming_b64))
    return base64.b64encode(doc.get_update()).decode()


def _to_dict(n: Note, with_content: bool = True) -> dict:
    d = {
        "id": n.id,
        "doc_id": n.doc_id,
        "title": n.title,
        "icon": n.icon,
        "versions_public": bool(n.versions_public),
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }
    if with_content:
        d["content"] = n.content
    return d


class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""
    icon: str | None = None
    doc_id: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    icon: str | None = None
    doc_id: str | None = None
    versions_public: bool | None = None


@router.get("/")
def list_notes(
    doc_id: str | None = None,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    q = db.query(Note).filter(Note.user_id == user_id, Note.group_id.is_(None))
    if doc_id:
        q = q.filter(Note.doc_id == doc_id)
    return [_to_dict(n, with_content=False) for n in q.order_by(Note.updated_at.desc()).all()]


@router.post("/")
def create_note(
    body: NoteCreate,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    now = datetime.utcnow()
    note = Note(
        id=str(uuid.uuid4()), user_id=user_id, doc_id=body.doc_id,
        title=body.title[:256], content=body.content, icon=body.icon,
        created_at=now, updated_at=now,
    )
    db.add(note)
    db.commit()
    return _to_dict(note)


_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024


@router.post("/images")
async def upload_image(
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    if file.content_type not in _IMAGE_TYPES:
        raise HTTPException(400, "PNG, JPG, GIF, WEBP 이미지만 올릴 수 있습니다.")
    data = await file.read(_MAX_IMAGE_BYTES + 1)
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(413, "이미지는 5MB 이하만 올릴 수 있습니다.")
    img = NoteImage(id=str(uuid.uuid4()), user_id=user_id, content_type=file.content_type, data=data)
    db.add(img)
    db.commit()
    return {"id": img.id, "url": f"/notes/images/{img.id}"}


@router.get("/images/{image_id}")
def get_image(image_id: str, db: Session = Depends(get_db)):
    # <img> 태그는 헤더를 못 보내므로 추측 불가능한 UUID 주소로만 보호한다
    img = db.query(NoteImage).filter(NoteImage.id == image_id).first()
    if not img:
        raise HTTPException(404, "이미지를 찾을 수 없습니다.")
    return Response(content=img.data, media_type=img.content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{note_id}")
def get_note(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    return _to_dict(_get_owned(db, note_id, _require_user(x_user_id)))


@router.patch("/{note_id}")
def update_note(
    note_id: str,
    body: NoteUpdate,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    fields = body.model_dump(exclude_unset=True)
    content_changed = False
    if "title" in fields:
        note.title = (fields["title"] or "")[:256]
    if "content" in fields:
        note.content = fields["content"] or ""
        content_changed = True
    if "icon" in fields:
        note.icon = fields["icon"]
    if "doc_id" in fields:
        note.doc_id = fields["doc_id"]
    if "versions_public" in fields:
        # 그룹 노트: 작성자 또는 그룹장만 변경 가능
        if note.group_id:
            g = db.query(StudyGroup).filter(StudyGroup.id == note.group_id).first()
            if note.user_id != user_id and (not g or g.owner_id != user_id):
                raise HTTPException(403, "작성자나 그룹장만 설정을 변경할 수 있습니다.")
        elif note.user_id != user_id:
            raise HTTPException(403, "본인 노트만 설정을 변경할 수 있습니다.")
        note.versions_public = fields["versions_public"]
    note.updated_at = datetime.utcnow()
    note.last_edited_by = user_id
    if content_changed:
        _maybe_save_version(db, note, user_id)
    db.commit()
    return _to_dict(note)


@router.delete("/{note_id}")
def delete_note(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if note.group_id and note.user_id != user_id:
        group = db.query(StudyGroup).filter(StudyGroup.id == note.group_id).first()
        if not group or group.owner_id != user_id:
            raise HTTPException(403, "작성자나 그룹장만 삭제할 수 있습니다.")
    db.delete(note)
    db.commit()
    return {"ok": True}


# ── 공동 노트 (Yjs) ─────────────────────────────────────

class YdocSave(BaseModel):
    update: str              # base64 Yjs 상태 (Y.encodeStateAsUpdate)
    title: str | None = None


@router.get("/{note_id}/ydoc")
def get_ydoc(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    note = _get_owned(db, note_id, _require_user(x_user_id))
    return {**_to_dict(note, with_content=False), "group_id": note.group_id, "user_id": note.user_id, "ydoc": note.ydoc}


@router.put("/{note_id}/ydoc")
def save_ydoc(
    note_id: str,
    body: YdocSave,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    try:
        note.ydoc = _merge_ydoc(note.ydoc, body.update)
    except Exception as e:
        raise HTTPException(400, f"노트 상태를 합칠 수 없습니다: {e}")
    if body.title is not None:
        note.title = body.title[:256]
    note.last_edited_by = user_id
    note.updated_at = datetime.utcnow()
    _maybe_save_version(db, note, user_id)
    db.commit()
    return {"ok": True, "updated_at": note.updated_at.isoformat()}


@router.get("/{note_id}/versions")
def list_versions(note_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if not _can_see_versions(note, user_id, db):
        raise HTTPException(403, "버전 기록을 볼 권한이 없습니다.")
    rows = (
        db.query(NoteVersion)
        .filter(NoteVersion.note_id == note_id)
        .order_by(NoteVersion.created_at.desc())
        .all()
    )
    return [{"id": r.id, "title": r.title, "user_id": r.user_id, "created_at": r.created_at.isoformat()} for r in rows]


@router.post("/{note_id}/versions/{version_id}/restore")
def restore_version(note_id: str, version_id: int, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    # 복원은 작성자·그룹장만
    if note.group_id:
        g = db.query(StudyGroup).filter(StudyGroup.id == note.group_id).first()
        if note.user_id != user_id and (not g or g.owner_id != user_id):
            raise HTTPException(403, "작성자나 그룹장만 복원할 수 있습니다.")
    elif note.user_id != user_id:
        raise HTTPException(403, "본인 노트만 복원할 수 있습니다.")
    ver = db.query(NoteVersion).filter(NoteVersion.id == version_id, NoteVersion.note_id == note_id).first()
    if not ver:
        raise HTTPException(404, "버전을 찾을 수 없습니다.")
    # 복원 전 현재 상태 보존
    db.add(NoteVersion(note_id=note.id, user_id=user_id, title=note.title or "",
                       ydoc=note.ydoc, content=note.content or None))
    note.ydoc = ver.ydoc
    note.content = ver.content or note.content
    note.title = ver.title
    note.last_edited_by = user_id
    note.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "title": note.title, "content": note.content, "updated_at": note.updated_at.isoformat()}
