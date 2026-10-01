from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.tutor import tutor_chat, summarize_concepts
from ..db.models import TutorThread
from ..db.session import SessionLocal

router = APIRouter(prefix="/tutor", tags=["tutor"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class TurnModel(BaseModel):
    role: str
    content: str


class TutorRequest(BaseModel):
    doc_id: str
    history: list[TurnModel] = []
    message: str


class SummaryRequest(BaseModel):
    history: list[TurnModel] = []


@router.post("/chat")
async def chat(req: TutorRequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    reply = tutor_chat(req.doc_id, [t.model_dump() for t in req.history], req.message)
    try:
        db.add(TutorThread(doc_id=req.doc_id, user_id=x_user_id, role="user", content=req.message))
        db.add(TutorThread(doc_id=req.doc_id, user_id=x_user_id, role="assistant", content=reply))
        db.commit()
    except Exception:
        pass
    return {"reply": reply}


@router.get("/history")
def get_history(doc_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    threads = (
        db.query(TutorThread)
        .filter(TutorThread.doc_id == doc_id, TutorThread.user_id == x_user_id)
        .order_by(TutorThread.created_at.asc())
        .limit(200)
        .all()
    )
    return [{"role": t.role, "content": t.content} for t in threads]


@router.post("/summary")
async def summary(req: SummaryRequest):
    return summarize_concepts([t.model_dump() for t in req.history])
