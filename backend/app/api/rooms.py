import asyncio
import json
import random
import string
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import QuizSession, StudyRoom, StudyRoomMember
from ..db.session import SessionLocal

router = APIRouter(prefix="/rooms", tags=["rooms"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _make_code(db: Session) -> str:
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db.query(StudyRoom).filter(StudyRoom.code == code).first():
            return code


class CreateRoomRequest(BaseModel):
    doc_id: str
    nickname: str


class JoinRoomRequest(BaseModel):
    code: str
    nickname: str


class SubmitRequest(BaseModel):
    answers: list[dict]  # [{id, answer}]


@router.post("/create")
def create_room(req: CreateRoomRequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    room_id = str(uuid.uuid4())
    code = _make_code(db)
    room = StudyRoom(id=room_id, code=code, doc_id=req.doc_id, host_user_id=x_user_id)
    db.add(room)
    db.add(StudyRoomMember(room_id=room_id, user_id=x_user_id, nickname=req.nickname))
    db.commit()
    return {"room_id": room_id, "code": code}


@router.post("/join")
def join_room(req: JoinRoomRequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    room = db.query(StudyRoom).filter(StudyRoom.code == req.code.upper()).first()
    if not room:
        raise HTTPException(404, "방을 찾을 수 없습니다.")
    if room.status == "finished":
        raise HTTPException(400, "이미 종료된 방입니다.")
    existing = db.query(StudyRoomMember).filter(
        StudyRoomMember.room_id == room.id, StudyRoomMember.user_id == x_user_id
    ).first()
    if not existing:
        db.add(StudyRoomMember(room_id=room.id, user_id=x_user_id, nickname=req.nickname))
        db.commit()
    return {"room_id": room.id, "doc_id": room.doc_id, "status": room.status, "host_user_id": room.host_user_id}


@router.get("/{room_id}")
def get_room(room_id: str, db: Session = Depends(get_db)):
    room = db.get(StudyRoom, room_id)
    if not room:
        raise HTTPException(404, "방을 찾을 수 없습니다.")
    members = db.query(StudyRoomMember).filter(StudyRoomMember.room_id == room_id).all()
    session_questions = None
    if room.session_id:
        qs = db.get(QuizSession, room.session_id)
        if qs:
            raw = json.loads(qs.questions_json)
            session_questions = [
                {"id": q["id"], "type": q["type"], "question": q["question"],
                 **({"options": q["options"]} if q["type"] == "multiple_choice" else {})}
                for q in raw
            ]
    return {
        "room_id": room.id,
        "code": room.code,
        "doc_id": room.doc_id,
        "status": room.status,
        "host_user_id": room.host_user_id,
        "members": [
            {"user_id": m.user_id, "nickname": m.nickname,
             "score": m.score, "total": m.total, "submitted_at": m.submitted_at.isoformat() if m.submitted_at else None}
            for m in members
        ],
        "questions": session_questions,
    }


@router.post("/{room_id}/start")
async def start_room(room_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    room = db.get(StudyRoom, room_id)
    if not room:
        raise HTTPException(404)
    if room.host_user_id != x_user_id:
        raise HTTPException(403, "호스트만 시작할 수 있습니다.")
    if room.status != "waiting":
        raise HTTPException(400, "이미 시작된 방입니다.")
    from ..core.quiz import generate_quiz
    questions = None
    last_err = None
    for attempt in range(3):
        try:
            questions = await asyncio.to_thread(generate_quiz, room.doc_id, 5)
            break
        except Exception as e:
            last_err = e
            await asyncio.sleep(2 ** attempt)
    if questions is None:
        raise HTTPException(503, f"퀴즈 생성 실패 (잠시 후 다시 시도): {last_err}")
    session_id = str(uuid.uuid4())
    db.add(QuizSession(id=session_id, doc_id=room.doc_id, questions_json=json.dumps(questions, ensure_ascii=False)))
    room.session_id = session_id
    room.status = "active"
    db.commit()
    return {"ok": True, "session_id": session_id}


@router.post("/{room_id}/submit")
def submit_answers(
    room_id: str, req: SubmitRequest,
    x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)
):
    room = db.get(StudyRoom, room_id)
    if not room or room.status != "active":
        raise HTTPException(400, "퀴즈가 진행 중이지 않습니다.")
    qs_row = db.get(QuizSession, room.session_id)
    if not qs_row:
        raise HTTPException(404)
    questions = json.loads(qs_row.questions_json)
    answer_map = {a["id"]: a["answer"] for a in req.answers}
    correct = sum(
        1 for q in questions
        if answer_map.get(q["id"], "").upper().strip() == q["answer"].upper().strip()
    )
    member = db.query(StudyRoomMember).filter(
        StudyRoomMember.room_id == room_id, StudyRoomMember.user_id == x_user_id
    ).first()
    if member:
        member.score = correct
        member.total = len(questions)
        member.submitted_at = datetime.utcnow()
        db.commit()
    return {"score": correct, "total": len(questions)}


@router.post("/{room_id}/finish")
def finish_room(room_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    room = db.get(StudyRoom, room_id)
    if not room:
        raise HTTPException(404)
    if room.host_user_id != x_user_id:
        raise HTTPException(403)
    room.status = "finished"
    db.commit()
    return {"ok": True}
