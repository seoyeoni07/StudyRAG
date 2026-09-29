from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.rag import query_rag
from ..db.models import QAFeedback
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
async def ask(req: QARequest):
    return query_rag(req.doc_id, req.question)


@router.post("/feedback")
def feedback(req: FeedbackRequest, db: Session = Depends(get_db)):
    db.add(QAFeedback(doc_id=req.doc_id, question=req.question, helpful=1 if req.helpful else -1))
    db.commit()
    return {"ok": True}
