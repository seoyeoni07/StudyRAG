import asyncio
import os
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.parser import extract_chunks_with_pages
from ..core.rag import add_chunks
from ..core.summarizer import summarize_document
from ..db.models import Document, QuizHistory, QuizSession, WrongAnswer
from ..db.session import SessionLocal

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").endswith(".pdf"):
        raise HTTPException(400, "PDF 파일만 업로드 가능합니다.")

    doc_id = str(uuid.uuid4())
    save_path = f"{UPLOAD_DIR}/{doc_id}.pdf"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    chunks_with_pages = extract_chunks_with_pages(save_path)
    if not chunks_with_pages:
        os.remove(save_path)
        raise HTTPException(422, "텍스트를 추출할 수 없습니다.")

    chunks = [c for c, _ in chunks_with_pages]
    add_chunks(
        doc_id,
        chunks,
        [{"doc_id": doc_id, "chunk_idx": i, "page": p} for i, (_, p) in enumerate(chunks_with_pages)],
    )

    if x_user_id:
        db.add(Document(id=doc_id, user_id=x_user_id, filename=file.filename, chunks=len(chunks)))
        db.commit()

    return {"doc_id": doc_id, "filename": file.filename, "chunks": len(chunks)}


@router.delete("/{doc_id}")
def delete_document(
    doc_id: str,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다.")
    if x_user_id and doc.user_id != x_user_id:
        raise HTTPException(403, "권한이 없습니다.")

    try:
        from ..core.rag import get_vectorstore
        get_vectorstore(doc_id).delete_collection()
    except Exception:
        pass

    db.query(WrongAnswer).filter(WrongAnswer.doc_id == doc_id).delete()
    db.query(QuizHistory).filter(QuizHistory.doc_id == doc_id).delete()
    db.query(QuizSession).filter(QuizSession.doc_id == doc_id).delete()
    db.query(Document).filter(Document.id == doc_id).delete()
    db.commit()
    return {"ok": True}


@router.get("/dashboard")
def get_dashboard(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not x_user_id:
        raise HTTPException(401)
    from datetime import datetime
    docs = db.query(Document).filter(Document.user_id == x_user_id).order_by(Document.created_at.desc()).all()
    doc_ids = [d.id for d in docs]
    doc_map = {d.id: d.filename for d in docs}
    now = datetime.utcnow()
    today_review = 0
    total_wrongs = 0
    if doc_ids:
        today_review = db.query(WrongAnswer).filter(
            WrongAnswer.doc_id.in_(doc_ids),
            WrongAnswer.reviewed == False,
            WrongAnswer.next_review <= now,
        ).count()
        total_wrongs = db.query(WrongAnswer).filter(
            WrongAnswer.doc_id.in_(doc_ids),
            WrongAnswer.reviewed == False,
        ).count()
    recent_quizzes = []
    if doc_ids:
        histories = db.query(QuizHistory).filter(
            QuizHistory.doc_id.in_(doc_ids)
        ).order_by(QuizHistory.created_at.desc()).limit(5).all()
        recent_quizzes = [
            {"doc_name": doc_map.get(h.doc_id, "알 수 없는 자료"), "doc_id": h.doc_id,
             "score": h.correct, "total": h.total, "date": h.created_at.isoformat()}
            for h in histories
        ]
    return {
        "today_review": today_review,
        "total_wrongs": total_wrongs,
        "total_docs": len(docs),
        "recent_quizzes": recent_quizzes,
    }


class FolderRequest(BaseModel):
    folder: str | None = None


@router.patch("/{doc_id}/folder")
def set_folder(doc_id: str, req: FolderRequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == x_user_id).first()
    if not doc:
        raise HTTPException(404)
    doc.folder = req.folder or None
    db.commit()
    return {"ok": True}


@router.get("/{doc_id}/history")
def get_doc_history(doc_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == x_user_id).first()
    if not doc:
        raise HTTPException(404)
    from datetime import datetime
    now = datetime.utcnow()
    quizzes = db.query(QuizHistory).filter(QuizHistory.doc_id == doc_id).order_by(QuizHistory.created_at.desc()).limit(20).all()
    total_wrongs = db.query(WrongAnswer).filter(WrongAnswer.doc_id == doc_id, WrongAnswer.reviewed == False).count()
    today_review = db.query(WrongAnswer).filter(
        WrongAnswer.doc_id == doc_id, WrongAnswer.reviewed == False, WrongAnswer.next_review <= now
    ).count()
    return {
        "doc_id": doc_id,
        "filename": doc.filename,
        "folder": doc.folder,
        "has_summary": bool(doc.summary),
        "chunks": doc.chunks,
        "created_at": doc.created_at.isoformat(),
        "total_wrongs": total_wrongs,
        "today_review": today_review,
        "quizzes": [
            {"score": h.correct, "total": h.total, "date": h.created_at.isoformat()}
            for h in quizzes
        ],
    }


@router.get("/{doc_id}/summary")
async def get_summary(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다.")
    if doc.summary:
        import json
        try:
            return json.loads(doc.summary)
        except Exception:
            pass
    result = await asyncio.to_thread(summarize_document, doc_id)
    try:
        import json
        doc.summary = json.dumps(result, ensure_ascii=False)
        db.commit()
    except Exception:
        pass
    return result


@router.get("/")
def list_documents(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not x_user_id:
        return []
    rows = (
        db.query(Document)
        .filter(Document.user_id == x_user_id)
        .order_by(Document.created_at.desc())
        .all()
    )
    return [
        {"doc_id": r.id, "filename": r.filename, "chunks": r.chunks, "folder": r.folder, "created_at": r.created_at.isoformat()}
        for r in rows
    ]
