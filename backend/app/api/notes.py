import base64
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import Note, StudyGroup, StudyGroupMember
from ..db.session import SessionLocal

router = APIRouter(prefix="/notes", tags=["notes"])


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
    if "title" in fields:
        note.title = (fields["title"] or "")[:256]
    if "content" in fields:
        note.content = fields["content"] or ""
    if "icon" in fields:
        note.icon = fields["icon"]
    if "doc_id" in fields:
        note.doc_id = fields["doc_id"]
    note.updated_at = datetime.utcnow()
    note.last_edited_by = user_id
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
    db.commit()
    return {"ok": True, "updated_at": note.updated_at.isoformat()}
