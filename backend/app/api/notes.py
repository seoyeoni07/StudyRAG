import base64
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db.models import Note, NoteImage, NoteShare, NoteVersion, StudyGroup, StudyGroupMember, UserProfile
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
    """개인 노트는 작성자·공유받은 사람, 그룹 노트는 그룹 멤버 누구나 접근할 수 있다."""
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(404, "노트를 찾을 수 없습니다.")
    if note.user_id == user_id:
        return note
    if note.group_id and _is_member(db, note.group_id, user_id):
        return note
    if not note.group_id and _shared_via_ancestors(db, note, user_id):
        return note
    raise HTTPException(403, "접근 권한이 없습니다.")


def _shared_via_ancestors(db: Session, note: Note, user_id: str) -> bool:
    """이 노트나 상위 페이지 중 하나라도 공유받았으면 볼 수 있다 (노션처럼 하위 페이지까지 공유)."""
    cur, seen = note, set()
    while cur and cur.id not in seen and len(seen) < 32:
        seen.add(cur.id)
        if db.query(NoteShare).filter(NoteShare.note_id == cur.id, NoteShare.shared_with == user_id).first():
            return True
        cur = db.query(Note).filter(Note.id == cur.parent_id).first() if cur.parent_id else None
    return False


def _descendant_ids(db: Session, note_id: str) -> list[str]:
    """하위 페이지 전부 (자기 자신 제외)."""
    out, frontier = [], [note_id]
    while frontier and len(out) < 2000:
        rows = [r.id for r in db.query(Note.id).filter(Note.parent_id.in_(frontier)).all()]
        rows = [r for r in rows if r not in out and r != note_id]
        out += rows
        frontier = rows
    return out


def _check_parent(db: Session, note: Note | None, parent_id: str, user_id: str, group_id: str | None) -> Note:
    """상위 페이지로 둘 수 있는지 — 같은 공간(같은 그룹 / 내 개인 노트)이고 자기 자신·하위 페이지가 아니어야 한다."""
    parent = db.query(Note).filter(Note.id == parent_id).first()
    if not parent or parent.group_id != group_id:
        raise HTTPException(400, "상위 페이지를 찾을 수 없습니다.")
    if not group_id and parent.user_id != user_id:
        raise HTTPException(403, "내 노트 아래에만 하위 페이지를 둘 수 있습니다.")
    if note and (parent.id == note.id or parent.id in _descendant_ids(db, note.id)):
        raise HTTPException(400, "자기 자신이나 하위 페이지 안으로는 옮길 수 없습니다.")
    return parent


def _set_ydoc_title(stored_b64: str | None, title: str) -> str | None:
    """에디터 제목은 Yjs 문서(meta.title)에 있으므로 사이드바에서 이름을 바꾸면 거기도 바꿔준다."""
    if not stored_b64:
        return stored_b64
    from pycrdt import Doc, Map

    doc = Doc()
    doc.apply_update(base64.b64decode(stored_b64))
    doc.get("meta", type=Map)["title"] = title
    return base64.b64encode(doc.get_update()).decode()


def _merge_ydoc(stored_b64: str | None, incoming_b64: str) -> str:
    """두 Yjs 상태를 합친다. 업데이트는 교환·멱등이라 순서와 중복에 상관없이 안전하다."""
    from pycrdt import Doc

    doc = Doc()
    if stored_b64:
        doc.apply_update(base64.b64decode(stored_b64))
    doc.apply_update(base64.b64decode(incoming_b64))
    return base64.b64encode(doc.get_update()).decode()


def _to_dict(n: Note, with_content: bool = True) -> dict:
    import json as _json
    tags = []
    if n.tags:
        try:
            tags = _json.loads(n.tags)
        except Exception:
            pass
    d = {
        "id": n.id,
        "user_id": n.user_id,
        "doc_id": n.doc_id,
        "title": n.title,
        "icon": n.icon,
        "tags": tags,
        "parent_id": n.parent_id,
        "group_id": n.group_id,
        "pinned": bool(n.pinned),
        "versions_public": bool(n.versions_public),
        "visibility": getattr(n, "visibility", "private") or "private",
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
    parent_id: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    icon: str | None = None
    doc_id: str | None = None
    versions_public: bool | None = None
    tags: list[str] | None = None
    parent_id: str | None = None   # null이면 최상위로
    pinned: bool | None = None


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
    if body.parent_id:
        _check_parent(db, None, body.parent_id, user_id, None)
    now = datetime.utcnow()
    note = Note(
        id=str(uuid.uuid4()), user_id=user_id, doc_id=body.doc_id, parent_id=body.parent_id,
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


_MAX_FILE_BYTES = 10 * 1024 * 1024
# 브라우저에서 바로 열어도 안전한 형식만 inline — 나머지(HTML, SVG 등)는 스크립트 실행을 막기 위해 다운로드로
_INLINE_PREFIXES = ("image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "audio/", "video/", "text/plain")


@router.post("/files")
async def upload_file(
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """노트 블록 에디터의 파일·이미지·영상·오디오 첨부. 10MB까지."""
    user_id = _require_user(x_user_id)
    data = await file.read(_MAX_FILE_BYTES + 1)
    if len(data) > _MAX_FILE_BYTES:
        raise HTTPException(413, "첨부파일은 10MB 이하만 올릴 수 있습니다.")
    if not data:
        raise HTTPException(400, "빈 파일입니다.")
    ct = (file.content_type or "application/octet-stream")[:128]
    name = (file.filename or "file")[:256]
    f = NoteImage(id=str(uuid.uuid4()), user_id=user_id, content_type=ct, filename=name, data=data)
    db.add(f)
    db.commit()
    return {"id": f.id, "url": f"/notes/files/{f.id}", "name": name, "content_type": ct, "size": len(data)}


@router.get("/files/{file_id}")
def get_file(file_id: str, db: Session = Depends(get_db)):
    # <a>/<img> 태그는 헤더를 못 보내므로 추측 불가능한 UUID 주소로만 보호한다
    f = db.query(NoteImage).filter(NoteImage.id == file_id).first()
    if not f:
        raise HTTPException(404, "파일을 찾을 수 없습니다.")
    from urllib.parse import quote
    inline = f.content_type.startswith(_INLINE_PREFIXES)
    name = quote(f.filename or "file")
    return Response(content=f.data, media_type=f.content_type if inline else "application/octet-stream",
                    headers={
                        "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{name}",
                        "X-Content-Type-Options": "nosniff",
                        "Cache-Control": "public, max-age=31536000, immutable",
                    })


@router.get("/search")
def search_notes(q: str = "", x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    if not q.strip():
        return []
    notes = (
        db.query(Note)
        .filter(
            Note.user_id == user_id,
            Note.group_id.is_(None),
            or_(Note.title.ilike(f"%{q}%"), Note.content.ilike(f"%{q}%")),
        )
        .order_by(Note.updated_at.desc())
        .limit(20)
        .all()
    )
    return [_to_dict(n, with_content=False) for n in notes]


@router.get("/shared-with-me")
def shared_with_me(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    shares = db.query(NoteShare).filter(NoteShare.shared_with == user_id).all()
    if not shares:
        return []
    note_ids = [s.note_id for s in shares]
    notes = db.query(Note).filter(Note.id.in_(note_ids), Note.group_id.is_(None)).all()
    return [_to_dict(n, with_content=False) for n in notes]


@router.get("/{note_id}")
def get_note(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(404, "노트를 찾을 수 없습니다.")
    if getattr(note, "visibility", "private") == "public":
        return _to_dict(note)
    return _to_dict(_get_owned(db, note_id, _require_user(x_user_id)))


@router.post("/{note_id}/request-access")
def request_access(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """비공개 노트에 접근 권한을 요청한다. 프론트엔드가 소유자 inbox에 알림을 보내기 위해 owner_id를 반환."""
    user_id = _require_user(x_user_id)
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(404, "노트를 찾을 수 없습니다.")
    if note.user_id == user_id:
        raise HTTPException(400, "본인 노트입니다.")
    if _shared_via_ancestors(db, note, user_id) or (note.group_id and _is_member(db, note.group_id, user_id)):
        raise HTTPException(400, "이미 접근 권한이 있습니다.")
    return {"owner_id": note.user_id, "title": note.title or "제목 없음"}


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
        note.ydoc = _set_ydoc_title(note.ydoc, note.title)
    if "parent_id" in fields:
        if not note.group_id and note.user_id != user_id:
            raise HTTPException(403, "본인 노트만 옮길 수 있습니다.")
        if fields["parent_id"]:
            _check_parent(db, note, fields["parent_id"], note.user_id, note.group_id)
        note.parent_id = fields["parent_id"] or None
    if "pinned" in fields and fields["pinned"] is not None:
        if note.user_id != user_id:
            raise HTTPException(403, "본인 노트만 즐겨찾기할 수 있습니다.")
        note.pinned = fields["pinned"]
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
    if "tags" in fields and fields["tags"] is not None:
        import json as _json
        note.tags = _json.dumps([t[:32] for t in fields["tags"][:10]], ensure_ascii=False)
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
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(404, "노트를 찾을 수 없습니다.")
    if note.group_id:
        # 그룹 노트: 작성자 또는 그룹장만 삭제
        _is_member(db, note.group_id, user_id)  # 멤버인지 확인
        group = db.query(StudyGroup).filter(StudyGroup.id == note.group_id).first()
        if note.user_id != user_id and (not group or group.owner_id != user_id):
            raise HTTPException(403, "작성자나 그룹장만 삭제할 수 있습니다.")
    else:
        # 개인 노트: 소유자만 삭제
        if note.user_id != user_id:
            raise HTTPException(403, "본인 노트만 삭제할 수 있습니다.")
    # 하위 페이지도 함께 삭제
    ids = [note.id, *_descendant_ids(db, note.id)]
    db.query(NoteShare).filter(NoteShare.note_id.in_(ids)).delete(synchronize_session=False)
    db.query(Note).filter(Note.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": ids}


@router.get("/{note_id}/children")
def list_children(note_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """하위 페이지 목록 (공유받은 노트의 하위 페이지도 볼 수 있다)."""
    note = _get_owned(db, note_id, _require_user(x_user_id))
    rows = db.query(Note).filter(Note.parent_id == note.id).order_by(Note.created_at).all()
    return [_to_dict(n, with_content=False) for n in rows]


@router.post("/{note_id}/duplicate")
def duplicate_note(note_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """노트 복제 — 같은 위치(같은 상위 페이지·그룹)에 '(사본)'으로. 하위 페이지는 복제하지 않는다."""
    user_id = _require_user(x_user_id)
    src = _get_owned(db, note_id, user_id)
    if not src.group_id and src.user_id != user_id:
        raise HTTPException(403, "본인 노트만 복제할 수 있습니다.")
    now = datetime.utcnow()
    title = f"{src.title or '제목 없음'} (사본)"[:256]
    n = Note(
        id=str(uuid.uuid4()), user_id=user_id, group_id=src.group_id, doc_id=src.doc_id, parent_id=src.parent_id,
        title=title, icon=src.icon, content=src.content or "", tags=src.tags,
        ydoc=_set_ydoc_title(src.ydoc, title), last_edited_by=user_id, created_at=now, updated_at=now,
    )
    db.add(n)
    db.commit()
    return _to_dict(n, with_content=False)


# ── 노트 공개 범위 ──────────────────────────────────────────

class VisibilityUpdate(BaseModel):
    visibility: str  # private | public

@router.patch("/{note_id}/visibility")
def set_visibility(note_id: str, body: VisibilityUpdate, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if note.user_id != user_id:
        raise HTTPException(403, "작성자만 공개 범위를 변경할 수 있습니다.")
    if body.visibility not in ("private", "public"):
        raise HTTPException(400, "잘못된 공개 범위입니다.")
    note.visibility = body.visibility
    db.commit()
    return {"visibility": note.visibility}


# ── 노트 공유 ────────────────────────────────────────────

class NoteShareCreate(BaseModel):
    user_id: str


@router.get("/{note_id}/shares")
def list_shares(note_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if note.user_id != user_id:
        raise HTTPException(403, "본인 노트만 공유 설정을 볼 수 있습니다.")
    shares = db.query(NoteShare).filter(NoteShare.note_id == note_id).all()
    uids = [s.shared_with for s in shares]
    profiles = {p.uid: p for p in db.query(UserProfile).filter(UserProfile.uid.in_(uids)).all()} if uids else {}
    return [
        {
            "uid": s.shared_with,
            "email": profiles[s.shared_with].email if s.shared_with in profiles else None,
            "display_name": profiles[s.shared_with].display_name if s.shared_with in profiles else s.shared_with,
        }
        for s in shares
    ]


@router.post("/{note_id}/shares")
def share_note(note_id: str, body: NoteShareCreate, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if note.user_id != user_id:
        raise HTTPException(403, "본인 노트만 공유할 수 있습니다.")
    if body.user_id == user_id:
        raise HTTPException(400, "자기 자신에게는 공유할 수 없습니다.")
    if not db.query(NoteShare).filter(NoteShare.note_id == note_id, NoteShare.shared_with == body.user_id).first():
        db.add(NoteShare(note_id=note_id, owner_id=user_id, shared_with=body.user_id))
        db.commit()
    return {"ok": True}


@router.delete("/{note_id}/shares/{target_uid}")
def unshare_note(note_id: str, target_uid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if note.user_id != user_id:
        raise HTTPException(403, "본인 노트만 공유 해제할 수 있습니다.")
    db.query(NoteShare).filter(NoteShare.note_id == note_id, NoteShare.shared_with == target_uid).delete()
    db.commit()
    return {"ok": True}


# ── 공동 노트 (Yjs) ─────────────────────────────────────

class YdocSave(BaseModel):
    update: str              # base64 Yjs 상태 (Y.encodeStateAsUpdate)
    title: str | None = None
    content: str | None = None  # 에디터 내용을 마크다운으로 — 노트 검색·미리보기용


@router.get("/{note_id}/ydoc")
def get_ydoc(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(404, "노트를 찾을 수 없습니다.")
    # 공개 노트는 로그인 없이도, 소유자가 아니어도 읽기 가능
    if getattr(note, "visibility", "private") != "public":
        note = _get_owned(db, note_id, _require_user(x_user_id))
    return {**_to_dict(note, with_content=False), "group_id": note.group_id, "user_id": note.user_id, "ydoc": note.ydoc,
            "legacy_markdown": note.content if not note.ydoc else None}


@router.put("/{note_id}/ydoc")
def save_ydoc(
    note_id: str,
    body: YdocSave,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if not note.ydoc and (note.content or "").strip() and not (body.content or "").strip():
        # 마크다운 노트(강의 요약 저장 등)를 블록으로 바꾸기 전에 온 빈 저장 — 내용이 지워지지 않게 무시
        return {"ok": True, "skipped": True, **_to_dict(note, with_content=False)}
    try:
        note.ydoc = _merge_ydoc(note.ydoc, body.update)
    except Exception as e:
        raise HTTPException(400, f"노트 상태를 합칠 수 없습니다: {e}")
    if body.title is not None:
        note.title = body.title[:256]
    if body.content is not None:
        note.content = body.content
    note.last_edited_by = user_id
    note.updated_at = datetime.utcnow()
    _maybe_save_version(db, note, user_id)
    db.commit()
    return {"ok": True, "updated_at": note.updated_at.isoformat(), **_to_dict(note, with_content=False)}


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


@router.get("/{note_id}/versions/{version_id}")
def get_version(note_id: str, version_id: int, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    note = _get_owned(db, note_id, user_id)
    if not _can_see_versions(note, user_id, db):
        raise HTTPException(403, "버전 기록을 볼 권한이 없습니다.")
    ver = db.query(NoteVersion).filter(NoteVersion.id == version_id, NoteVersion.note_id == note_id).first()
    if not ver:
        raise HTTPException(404, "버전을 찾을 수 없습니다.")
    return {"id": ver.id, "title": ver.title, "content": ver.content, "ydoc": ver.ydoc,
            "created_at": ver.created_at.isoformat()}


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
