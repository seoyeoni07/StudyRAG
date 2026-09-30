import json

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.rag import query_rag
from ..db.models import QAFeedback, QAThread
from ..db.session import SessionLocal

router = APIRouter(prefix="/qa", tags=["qa"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class QARequest(BaseModel):
    doc_id: str
    question: str


class FeedbackRequest(BaseModel):
    doc_id: str
    question: str
    helpful: bool


@router.post("/")
async def ask(req: QARequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    result = query_rag(req.doc_id, req.question)
    try:
        db.add(QAThread(
            doc_id=req.doc_id,
            user_id=x_user_id,
            question=req.question,
            answer=result.get("answer", ""),
            sources_json=json.dumps(result.get("sources", []), ensure_ascii=False),
        ))
        db.commit()
    except Exception:
        pass
    return result


@router.get("/history")
def get_history(doc_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    threads = (
        db.query(QAThread)
        .filter(QAThread.doc_id == doc_id, QAThread.user_id == x_user_id)
        .order_by(QAThread.created_at.asc())
        .limit(100)
        .all()
    )
    return [
        {
            "question": t.question,
            "answer": t.answer,
            "sources": json.loads(t.sources_json) if t.sources_json else [],
            "created_at": t.created_at.isoformat(),
        }
        for t in threads
    ]


@router.post("/feedback")
def feedback(req: FeedbackRequest, db: Session = Depends(get_db)):
    db.add(QAFeedback(doc_id=req.doc_id, question=req.question, helpful=1 if req.helpful else -1))
    db.commit()
    return {"ok": True}
