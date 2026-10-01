import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import Note
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


def _get_owned(db: Session, note_id: str, user_id: str) -> Note:
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == user_id).first()
    if not note:
        raise HTTPException(404, "노트를 찾을 수 없습니다.")
    return note


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
    q = db.query(Note).filter(Note.user_id == user_id)
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
    note = _get_owned(db, note_id, _require_user(x_user_id))
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
    db.commit()
    return _to_dict(note)


@router.delete("/{note_id}")
def delete_note(
    note_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    note = _get_owned(db, note_id, _require_user(x_user_id))
    db.delete(note)
    db.commit()
    return {"ok": True}
