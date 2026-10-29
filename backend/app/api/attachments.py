"""채팅 메시지 첨부파일 공용 처리.

파일 자체는 POST /notes/files 로 먼저 올리고(DB 저장), 메시지에는 그 주소와 이름만 붙인다.
주소는 우리 서버의 /notes/files/{uuid} 만 허용 — 임의 링크(javascript: 등)를 첨부로 넣지 못하게.
"""
import re

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import NoteImage

_URL_RE = re.compile(r"^/notes/files/([0-9a-f-]{36})$")


class Attachment(BaseModel):
    url: str
    name: str | None = None
    type: str | None = None
    size: int | None = None


def validate_attachment(db: Session, att: Attachment | None) -> dict:
    """첨부가 있으면 메시지 컬럼에 넣을 값 dict, 없으면 빈 dict."""
    if att is None:
        return {}
    m = _URL_RE.match(att.url or "")
    if not m:
        raise HTTPException(400, "올바르지 않은 첨부파일입니다.")
    from sqlalchemy import func
    f = (db.query(NoteImage.filename, NoteImage.content_type, func.length(NoteImage.data))
         .filter(NoteImage.id == m.group(1)).first())
    if not f:
        raise HTTPException(400, "첨부파일을 찾을 수 없습니다. 다시 올려주세요.")
    filename, content_type, size = f
    return {
        "attachment_url": att.url,
        "attachment_name": (filename or att.name or "file")[:256],
        "attachment_type": content_type[:128],
        "attachment_size": size,
    }


def attachment_out(m) -> dict | None:
    if not getattr(m, "attachment_url", None):
        return None
    return {"url": m.attachment_url, "name": m.attachment_name,
            "type": m.attachment_type, "size": m.attachment_size}


def preview_text(m) -> str:
    """대화 목록 미리보기 — 사진·파일만 보낸 메시지도 뭔가 보이게."""
    if m.content:
        return m.content
    if getattr(m, "attachment_url", None):
        return "📷 사진" if (m.attachment_type or "").startswith("image/") else f"📎 {m.attachment_name or '파일'}"
    return ""


# ── 읽음 위치 ────────────────────────────────────────────────────────────────

def mark_read(db: Session, room_key: str, user_id: str, last_id: int) -> int:
    """읽은 위치를 앞으로만 옮긴다. 저장된 값을 돌려준다."""
    from datetime import datetime
    from ..db.models import ChatRead
    from sqlalchemy.exc import IntegrityError
    for _ in range(2):  # 같은 사람이 탭 두 개에서 동시에 처음 읽으면 한쪽 INSERT가 겹칠 수 있다
        r = db.query(ChatRead).filter(ChatRead.room_key == room_key, ChatRead.user_id == user_id).first()
        if not r:
            r = ChatRead(room_key=room_key, user_id=user_id, last_read_id=0)
            db.add(r)
        if last_id > (r.last_read_id or 0):
            r.last_read_id = last_id
            r.updated_at = datetime.utcnow()
        value = r.last_read_id
        try:
            db.commit()
            return value
        except IntegrityError:
            db.rollback()
    return last_id


def read_positions(db: Session, room_key: str) -> list[dict]:
    from ..db.models import ChatRead
    rows = db.query(ChatRead.user_id, ChatRead.last_read_id).filter(ChatRead.room_key == room_key).all()
    return [{"user_id": u, "last_read_id": n} for u, n in rows]


class ReadBody(BaseModel):
    last_id: int
