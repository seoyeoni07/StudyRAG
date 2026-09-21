from fastapi import APIRouter
from pydantic import BaseModel

from ..core.rag import query_rag

router = APIRouter(prefix="/qa", tags=["qa"])


class QARequest(BaseModel):
    doc_id: str
    question: str


@router.post("/")
async def ask(req: QARequest):
    return query_rag(req.doc_id, req.question)
