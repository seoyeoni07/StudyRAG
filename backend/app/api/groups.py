import secrets
import string
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import Document, Note, StudyGroup, StudyGroupMember
from ..db.session import SessionLocal
from .documents import ingest_upload

router = APIRouter(prefix="/groups", tags=["groups"])

_CODE_ALPHABET = string.ascii_uppercase + string.digits


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


def require_member(db: Session, group_id: str, user_id: str) -> StudyGroupMember:
    m = (
        db.query(StudyGroupMember)
        .filter(StudyGroupMember.group_id == group_id, StudyGroupMember.user_id == user_id)
        .first()
    )
    if not m:
        raise HTTPException(403, "이 그룹의 멤버가 아닙니다.")
    return m


def _new_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        if not db.query(StudyGroup).filter(StudyGroup.invite_code == code).first():
            return code
    raise HTTPException(500, "초대 코드를 만들 수 없습니다.")


def _name_map(db: Session, group_id: str) -> dict[str, str]:
    rows = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == group_id).all()
    return {r.user_id: r.display_name for r in rows}


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _group_dict(g: StudyGroup, member_count: int, my_role: str) -> dict:
    return {
        "id": g.id, "name": g.name, "invite_code": g.invite_code,
        "visibility": g.visibility or "code", "level": g.level, "sublevel": g.sublevel, "subject": g.subject,
        "member_count": member_count, "my_role": my_role, "created_at": _iso(g.created_at),
    }


# ── Groups ───────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str
    display_name: str
    visibility: str = "code"   # public | code
    level: str | None = None
    sublevel: str | None = None
    subject: str | None = None


class GroupJoin(BaseModel):
    code: str
    display_name: str


class GroupJoinPublic(BaseModel):
    group_id: str
    display_name: str


@router.get("/")
def list_groups(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    mine = db.query(StudyGroupMember).filter(StudyGroupMember.user_id == user_id).all()
    out = []
    for m in mine:
        g = db.query(StudyGroup).filter(StudyGroup.id == m.group_id).first()
        if not g:
            continue
        count = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id).count()
        out.append(_group_dict(g, count, m.role))
    out.sort(key=lambda d: d["created_at"] or "")
    return out


@router.post("/")
def create_group(body: GroupCreate, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    name = body.name.strip()[:64]
    if not name:
        raise HTTPException(400, "그룹 이름을 입력하세요.")
    visibility = body.visibility if body.visibility in ("public", "code") else "code"
    g = StudyGroup(
        id=str(uuid.uuid4()), name=name, invite_code=_new_code(db), owner_id=user_id,
        visibility=visibility,
        level=(body.level or None),
        sublevel=(body.sublevel or None),
        subject=(body.subject.strip()[:64] if body.subject else None),
    )
    db.add(g)
    db.add(StudyGroupMember(group_id=g.id, user_id=user_id,
                            display_name=(body.display_name.strip() or "나")[:64], role="owner"))
    db.commit()
    return _group_dict(g, 1, "owner")


@router.post("/join")
def join_group(body: GroupJoin, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    g = db.query(StudyGroup).filter(StudyGroup.invite_code == body.code.strip().upper()).first()
    if not g:
        raise HTTPException(404, "초대 코드에 해당하는 그룹이 없습니다.")
    m = (
        db.query(StudyGroupMember)
        .filter(StudyGroupMember.group_id == g.id, StudyGroupMember.user_id == user_id)
        .first()
    )
    if not m:
        m = StudyGroupMember(group_id=g.id, user_id=user_id,
                             display_name=(body.display_name.strip() or "멤버")[:64], role="member")
        db.add(m)
        db.commit()
    count = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id).count()
    return _group_dict(g, count, m.role)


@router.get("/search")
def search_groups(q: str = "", level: str = "", db: Session = Depends(get_db)):
    query = db.query(StudyGroup).filter(StudyGroup.visibility == "public")
    if q:
        query = query.filter(
            StudyGroup.name.ilike(f"%{q}%") | StudyGroup.subject.ilike(f"%{q}%")
        )
    if level:
        query = query.filter(StudyGroup.level == level)
    groups = query.order_by(StudyGroup.created_at.desc()).limit(20).all()
    return [_group_dict(g, db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id).count(), "none") for g in groups]


@router.post("/join-public")
def join_public_group(body: GroupJoinPublic, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    g = db.query(StudyGroup).filter(StudyGroup.id == body.group_id, StudyGroup.visibility == "public").first()
    if not g:
        raise HTTPException(404, "공개 그룹을 찾을 수 없습니다.")
    m = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id, StudyGroupMember.user_id == user_id).first()
    if not m:
        m = StudyGroupMember(group_id=g.id, user_id=user_id,
                             display_name=(body.display_name.strip() or "멤버")[:64], role="member")
        db.add(m)
        db.commit()
    count = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id).count()
    return _group_dict(g, count, m.role)


@router.get("/{group_id}")
def get_group(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    me = require_member(db, group_id, user_id)
    g = db.query(StudyGroup).filter(StudyGroup.id == group_id).first()
    members = (
        db.query(StudyGroupMember)
        .filter(StudyGroupMember.group_id == group_id)
        .order_by(StudyGroupMember.joined_at)
        .all()
    )
    return {
        **_group_dict(g, len(members), me.role),
        "members": [
            {"user_id": m.user_id, "display_name": m.display_name, "role": m.role, "joined_at": _iso(m.joined_at)}
            for m in members
        ],
    }


@router.get("/{group_id}/activity")
def get_group_activity(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    require_member(db, group_id, _require_user(x_user_id))
    members = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == group_id).all()
    doc_ids = [d.id for d in db.query(Document.id).filter(Document.group_id == group_id).all()]

    result = []
    for m in members:
        uploads = db.query(Document).filter(Document.group_id == group_id, Document.user_id == m.user_id).count()
        notes_created = db.query(Note).filter(Note.group_id == group_id, Note.user_id == m.user_id).count()
        result.append({
            "user_id": m.user_id,
            "display_name": m.display_name,
            "role": m.role,
            "uploads": uploads,
            "notes": notes_created,
        })

    result.sort(key=lambda x: -(x["uploads"] + x["notes"]))
    return result


@router.delete("/{group_id}")
def delete_group(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    me = require_member(db, group_id, user_id)
    if me.role != "owner":
        raise HTTPException(403, "그룹장만 삭제할 수 있습니다.")
    db.query(StudyGroupMember).filter(StudyGroupMember.group_id == group_id).delete()
    db.query(StudyGroup).filter(StudyGroup.id == group_id).delete()
    db.commit()
    return {"ok": True}


@router.delete("/{group_id}/members/me")
def leave_group(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    me = require_member(db, group_id, user_id)
    if me.role == "owner":
        raise HTTPException(400, "그룹장은 나갈 수 없습니다. 그룹을 삭제하거나 다른 멤버에게 소유권을 넘겨주세요.")
    db.delete(me)
    db.commit()
    return {"ok": True}


# ── Shared documents ─────────────────────────────────────

@router.get("/{group_id}/documents")
def list_group_documents(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    require_member(db, group_id, _require_user(x_user_id))
    names = _name_map(db, group_id)
    rows = (
        db.query(Document)
        .filter(Document.group_id == group_id)
        .order_by(Document.created_at.desc())
        .all()
    )
    return [
        {
            "doc_id": r.id, "filename": r.filename, "chunks": r.chunks,
            "uploaded_by": r.user_id, "uploader_name": names.get(r.user_id, "나간 멤버"),
            "status": r.status or "done",
            "created_at": _iso(r.created_at),
        }
        for r in rows
    ]


@router.post("/{group_id}/documents")
async def upload_group_document(
    group_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    me = require_member(db, group_id, user_id)
    data = await file.read()
    import asyncio
    result = await asyncio.to_thread(ingest_upload, file, data, user_id, db, background_tasks, group_id)
    return {**result, "uploaded_by": user_id, "uploader_name": me.display_name,
            "created_at": datetime.utcnow().isoformat()}


# ── Shared notes ─────────────────────────────────────────

class GroupNoteCreate(BaseModel):
    title: str = ""
    icon: str | None = None
    doc_id: str | None = None


def group_note_dict(n: Note, names: dict[str, str]) -> dict:
    return {
        "id": n.id, "group_id": n.group_id, "doc_id": n.doc_id,
        "title": n.title, "icon": n.icon,
        "created_by": n.user_id, "creator_name": names.get(n.user_id, "나간 멤버"),
        "last_edited_by": n.last_edited_by,
        "last_editor_name": names.get(n.last_edited_by) if n.last_edited_by else None,
        "created_at": _iso(n.created_at), "updated_at": _iso(n.updated_at),
    }


@router.get("/{group_id}/notes")
def list_group_notes(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    require_member(db, group_id, _require_user(x_user_id))
    names = _name_map(db, group_id)
    rows = db.query(Note).filter(Note.group_id == group_id).order_by(Note.updated_at.desc()).all()
    return [group_note_dict(n, names) for n in rows]


@router.post("/{group_id}/notes")
def create_group_note(
    group_id: str,
    body: GroupNoteCreate,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    now = datetime.utcnow()
    n = Note(
        id=str(uuid.uuid4()), user_id=user_id, group_id=group_id, doc_id=body.doc_id,
        title=body.title[:256], icon=body.icon or "📄", content="",
        last_edited_by=user_id, created_at=now, updated_at=now,
    )
    db.add(n)
    db.commit()
    return group_note_dict(n, _name_map(db, group_id))
