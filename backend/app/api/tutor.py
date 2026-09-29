from fastapi import APIRouter
from pydantic import BaseModel

from ..core.tutor import tutor_chat, summarize_concepts

router = APIRouter(prefix="/tutor", tags=["tutor"])


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
async def chat(req: TutorRequest):
    reply = tutor_chat(req.doc_id, [t.model_dump() for t in req.history], req.message)
    return {"reply": reply}


@router.post("/summary")
async def summary(req: SummaryRequest):
    return summarize_concepts([t.model_dump() for t in req.history])
