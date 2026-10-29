import uuid
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import DmRoom, DmMessage, UserProfile
from ..db.session import SessionLocal
from .attachments import Attachment, ReadBody, attachment_out, mark_read, preview_text, read_positions, validate_attachment

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
    from sqlalchemy import and_, func, literal, or_
    from ..db.models import ChatRead
    rooms = db.query(DmRoom).filter(or_(DmRoom.user1_id == me, DmRoom.user2_id == me)).all()
    if not rooms:
        return []
    ids = [r.id for r in rooms]
    other_ids = {r.id: (r.user2_id if r.user1_id == me else r.user1_id) for r in rooms}

    # 방마다 쿼리하던 것(방 수 × 2번)을 한 번씩으로 — 서버↔DB 왕복이 비싸다
    last_ids = dict(db.query(DmMessage.room_id, func.max(DmMessage.id))
                    .filter(DmMessage.room_id.in_(ids)).group_by(DmMessage.room_id).all())
    lasts = {m.room_id: m for m in db.query(DmMessage).filter(DmMessage.id.in_(list(last_ids.values()) or [-1])).all()}
    profiles = {p.uid: p for p in db.query(UserProfile).filter(UserProfile.uid.in_(set(other_ids.values()))).all()}
    # 안 읽은 개수: 상대가 보낸 메시지 중 내 읽음 위치보다 뒤에 있는 것
    unread = dict(
        db.query(DmMessage.room_id, func.count(DmMessage.id))
        .outerjoin(ChatRead, and_(ChatRead.room_key == literal("dm:").concat(DmMessage.room_id), ChatRead.user_id == me))
        .filter(DmMessage.room_id.in_(ids), DmMessage.user_id != me,
                DmMessage.id > func.coalesce(ChatRead.last_read_id, 0))
        .group_by(DmMessage.room_id).all()
    )

    result = []
    for r in rooms:
        oid = other_ids[r.id]
        p = profiles.get(oid)
        last = lasts.get(r.id)
        result.append({
            "room_id": r.id,
            "other": {"uid": oid, "display_name": (p.display_name if p else None) or oid[:8],
                      "email": p.email if p else None},
            "last_message": preview_text(last) if last else None,
            "last_at": _iso(last.created_at) if last else _iso(r.created_at),
            "unread": unread.get(r.id, 0),
        })
    result.sort(key=lambda x: x["last_at"] or "", reverse=True)
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
        _msg_out(m) for m in msgs[-100:]
    ]


def _msg_out(m: DmMessage) -> dict:
    return {"id": m.id, "user_id": m.user_id, "display_name": m.display_name,
            "content": m.content, "attachment": attachment_out(m), "created_at": _iso(m.created_at)}


class SendDmBody(BaseModel):
    content: str = ""
    display_name: str | None = None
    attachment: Attachment | None = None


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
    att = validate_attachment(db, body.attachment)
    if not content and not att:
        raise HTTPException(400, "메시지가 비어 있습니다.")
    display_name = body.display_name
    if not display_name:  # 화면이 이름을 보내주면 프로필 조회(DB 왕복 1번)를 건너뛴다
        p = db.query(UserProfile).filter(UserProfile.uid == me).first()
        display_name = (p.display_name if p else None) or me[:8]
    msg = DmMessage(
        room_id=room_id, user_id=me, display_name=display_name[:64], content=content[:2000],
        created_at=datetime.utcnow(), **att,
    )
    db.add(msg)
    db.flush()               # INSERT … RETURNING id
    out = _msg_out(msg)      # commit 뒤에 읽으면 다시 SELECT 하므로 먼저 만든다
    db.commit()
    return out


@router.get("/rooms/{room_id}/reads")
def get_dm_reads(room_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require(x_user_id)
    room = db.query(DmRoom).filter(DmRoom.id == room_id).first()
    if not room or me not in (room.user1_id, room.user2_id):
        raise HTTPException(403, "권한이 없습니다.")
    return read_positions(db, f"dm:{room_id}")


@router.post("/rooms/{room_id}/read")
def read_dm(room_id: str, body: ReadBody, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require(x_user_id)
    room = db.query(DmRoom).filter(DmRoom.id == room_id).first()
    if not room or me not in (room.user1_id, room.user2_id):
        raise HTTPException(403, "권한이 없습니다.")
    return {"last_read_id": mark_read(db, f"dm:{room_id}", me, body.last_id)}
