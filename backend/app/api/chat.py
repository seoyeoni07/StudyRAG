import uuid
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import DmRoom, DmMessage, UserProfile
from ..db.session import SessionLocal

router = APIRouter(prefix="/chat", tags=["chat"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _require(uid):
    if not uid:
        raise HTTPException(401, "로그인이 필요합니다.")
    return uid


def _iso(dt):
    return dt.isoformat() if dt else None


def _room_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _other_profile(db: Session, other_id: str) -> dict:
    p = db.query(UserProfile).filter(UserProfile.uid == other_id).first()
    return {
        "uid": other_id,
        "display_name": (p.display_name if p else None) or other_id[:8],
        "email": p.email if p else None,
    }


# ── 목록 ──────────────────────────────────────────────────────────────────────

@router.get("/rooms")
def list_dm_rooms(
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    me = _require(x_user_id)
    from sqlalchemy import or_
    rooms = db.query(DmRoom).filter(
        or_(DmRoom.user1_id == me, DmRoom.user2_id == me)
    ).order_by(DmRoom.created_at.desc()).all()

    result = []
    for r in rooms:
        other_id = r.user2_id if r.user1_id == me else r.user1_id
        last = db.query(DmMessage).filter(DmMessage.room_id == r.id).order_by(DmMessage.id.desc()).first()
        result.append({
            "room_id": r.id,
            "other": _other_profile(db, other_id),
            "last_message": last.content if last else None,
            "last_at": _iso(last.created_at) if last else _iso(r.created_at),
        })
    return result


# ── 방 만들기 / 가져오기 ────────────────────────────────────────────────────────

class StartDmBody(BaseModel):
    other_user_id: str
    my_display_name: str | None = None


@router.post("/rooms")
def start_or_get_dm(
    body: StartDmBody,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    me = _require(x_user_id)
    if me == body.other_user_id:
        raise HTTPException(400, "자기 자신에게는 DM을 보낼 수 없습니다.")
    u1, u2 = _room_key(me, body.other_user_id)
    room = db.query(DmRoom).filter(DmRoom.user1_id == u1, DmRoom.user2_id == u2).first()
    if not room:
        room = DmRoom(id=str(uuid.uuid4()), user1_id=u1, user2_id=u2)
        db.add(room)
        db.commit()
    other = _other_profile(db, body.other_user_id)
    return {"room_id": room.id, "other": other}


# ── 메시지 ─────────────────────────────────────────────────────────────────────

@router.get("/rooms/{room_id}/messages")
def get_dm_messages(
    room_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    me = _require(x_user_id)
    room = db.query(DmRoom).filter(DmRoom.id == room_id).first()
    if not room or me not in (room.user1_id, room.user2_id):
        raise HTTPException(403, "권한이 없습니다.")
    msgs = db.query(DmMessage).filter(DmMessage.room_id == room_id).order_by(DmMessage.id).all()
    return [
        {"id": m.id, "user_id": m.user_id, "display_name": m.display_name,
         "content": m.content, "created_at": _iso(m.created_at)}
        for m in msgs[-100:]
    ]


class SendDmBody(BaseModel):
    content: str
    display_name: str | None = None


@router.post("/rooms/{room_id}/messages")
def send_dm(
    room_id: str,
    body: SendDmBody,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    me = _require(x_user_id)
    room = db.query(DmRoom).filter(DmRoom.id == room_id).first()
    if not room or me not in (room.user1_id, room.user2_id):
        raise HTTPException(403, "권한이 없습니다.")
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "메시지가 비어 있습니다.")
    p = db.query(UserProfile).filter(UserProfile.uid == me).first()
    display_name = body.display_name or (p.display_name if p else None) or me[:8]
    msg = DmMessage(
        room_id=room_id, user_id=me,
        display_name=display_name[:64], content=content[:2000],
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {"id": msg.id, "user_id": msg.user_id, "display_name": msg.display_name,
            "content": msg.content, "created_at": _iso(msg.created_at)}
