import asyncio
import logging
import os
import shutil
import threading
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.parser import chunk_text, extract_chunks_with_pages, extract_text_from_image
from ..core.rag import add_chunks
from ..core.summarizer import summarize_document
from ..db.models import Document, DocumentFile, QuizHistory, QuizSession, WrongAnswer
from ..db.session import SessionLocal

log = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif"}


@router.get("/upload-status/{doc_id}")
def upload_status(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다.")
    return {"status": doc.status or "done", "error": doc.error, "chunks": doc.chunks}


def _file_kind(file: UploadFile) -> tuple[str, str, str]:
    fname = file.filename or "untitled"
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    ct = file.content_type or ""
    if ct == "application/pdf" or ext == "pdf":
        return "pdf", fname, ct
    if ct.startswith("image/") or ext in _IMAGE_EXTS:
        return "image", fname, ct or f"image/{'jpeg' if ext == 'jpg' else ext}"
    raise HTTPException(400, "PDF 또는 이미지(JPG, PNG, WEBP) 파일만 업로드 가능합니다.")


def _ingest_pdf(data: bytes, doc_id: str) -> tuple[list[str], list[dict]]:
    save_path = f"{UPLOAD_DIR}/{doc_id}.pdf"
    with open(save_path, "wb") as f:
        f.write(data)
    chunks_with_pages = extract_chunks_with_pages(save_path)
    if not chunks_with_pages:
        os.remove(save_path)
        raise HTTPException(422, "텍스트를 추출할 수 없습니다.")
    chunks = [c for c, _ in chunks_with_pages]
    metas = [{"doc_id": doc_id, "chunk_idx": i, "page": p} for i, (_, p) in enumerate(chunks_with_pages)]
    return chunks, metas


def ingest_upload(
    file: UploadFile, data: bytes, x_user_id: str | None, db: Session,
    background_tasks: BackgroundTasks, group_id: str | None = None,
) -> dict:
    """개인·그룹 업로드 공통.

    PDF: 바로 추출·임베딩 (status=done).
    이미지: 원본을 DB에 저장하고 글자 인식은 백그라운드로 (status=processing) — 비전 모델이 느리고
    무료 모델은 자주 막히므로 요청을 붙잡고 있지 않는다. 실패하면 status=failed + 다시 시도 가능.
    """
    kind, fname, ct = _file_kind(file)
    doc_id = str(uuid.uuid4())

    if kind == "pdf":
        chunks, metas = _ingest_pdf(data, doc_id)
        add_chunks(doc_id, chunks, metas)
        if x_user_id:
            db.add(Document(id=doc_id, user_id=x_user_id, filename=fname, chunks=len(chunks),
                            group_id=group_id, status="done"))
            db.commit()
        return {"doc_id": doc_id, "filename": fname, "chunks": len(chunks), "status": "done"}

    if not x_user_id:
        raise HTTPException(401, "이미지 자료는 로그인 후 올릴 수 있습니다.")
    db.add(Document(id=doc_id, user_id=x_user_id, filename=fname, chunks=0,
                    group_id=group_id, status="processing"))
    db.add(DocumentFile(doc_id=doc_id, content_type=ct, data=data))
    db.commit()
    background_tasks.add_task(_bg_image_ocr, doc_id)
    return {"doc_id": doc_id, "filename": fname, "chunks": 0, "status": "processing"}


@router.post("/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    data = await file.read()
    return await asyncio.to_thread(ingest_upload, file, data, x_user_id, db, background_tasks)


def _bg_image_ocr(doc_id: str):
    """이미지 글자 인식 + 임베딩. 결과는 Document.status/error에 남긴다."""
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        src = db.query(DocumentFile).filter(DocumentFile.doc_id == doc_id).first()
        if not doc or not src:
            return
        try:
            text = extract_text_from_image(src.data, src.content_type)
            if not text.strip():
                raise ValueError("이미지에서 글자를 찾지 못했습니다.")
            chunks = chunk_text(text) or [text]
            metas = [{"doc_id": doc_id, "chunk_idx": i, "page": 1} for i in range(len(chunks))]
            try:
                from ..core.rag import get_vectorstore
                get_vectorstore(doc_id).delete_collection()  # 재시도 시 이전 조각 제거
            except Exception:
                pass
            add_chunks(doc_id, chunks, metas)
            doc.chunks, doc.status, doc.error, doc.summary = len(chunks), "done", None, None
            log.info("Image OCR done: %s (%d chunks)", doc.filename, len(chunks))
        except Exception as e:
            log.error("Image OCR failed for %s: %s", doc.filename, e)
            doc.status, doc.error = "failed", str(e)[:500]
        db.commit()
    finally:
        db.close()


@router.post("/{doc_id}/reprocess")
def reprocess_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    x_user_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다.")
    allowed = doc.user_id == x_user_id
    if not allowed and doc.group_id and x_user_id:
        from ..db.models import StudyGroupMember
        allowed = db.query(StudyGroupMember).filter(
            StudyGroupMember.group_id == doc.group_id, StudyGroupMember.user_id == x_user_id
        ).first() is not None
    if not allowed:
        raise HTTPException(403, "권한이 없습니다.")
    if not db.query(DocumentFile).filter(DocumentFile.doc_id == doc_id).first():
        raise HTTPException(400, "원본 이미지가 없어 다시 시도할 수 없습니다. 파일을 다시 올려주세요.")
    if doc.status == "processing":
        return {"status": "processing"}
    doc.status, doc.error = "processing", None
    db.commit()
    background_tasks.add_task(_bg_image_ocr, doc_id)
    return {"status": "processing"}




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
        from ..db.models import StudyGroup
        group = db.query(StudyGroup).filter(StudyGroup.id == doc.group_id).first() if doc.group_id else None
        if not group or group.owner_id != x_user_id:
            raise HTTPException(403, "권한이 없습니다.")

    try:
        from ..core.rag import get_vectorstore
        get_vectorstore(doc_id).delete_collection()
    except Exception:
        pass

    db.query(DocumentFile).filter(DocumentFile.doc_id == doc_id).delete()
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
    docs = db.query(Document).filter(Document.user_id == x_user_id, Document.group_id.is_(None)).order_by(Document.created_at.desc()).all()
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
    today_docs = []
    if doc_ids and today_review > 0:
        for doc in docs:
            cnt = db.query(WrongAnswer).filter(
                WrongAnswer.doc_id == doc.id,
                WrongAnswer.reviewed == False,
                WrongAnswer.next_review <= now,
            ).count()
            if cnt:
                today_docs.append({"doc_id": doc.id, "filename": doc.filename, "count": cnt})
    return {
        "today_review": today_review,
        "total_wrongs": total_wrongs,
        "total_docs": len(docs),
        "recent_quizzes": recent_quizzes,
        "today_docs": today_docs,
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
    if doc.status == "processing":
        raise HTTPException(409, "이미지에서 글자를 인식하는 중이에요. 잠시 후 다시 시도해주세요.")
    if doc.status == "failed":
        raise HTTPException(409, "이미지 인식에 실패한 자료예요. 다시 시도한 뒤 요약할 수 있어요.")
    if doc.summary:
        import json
        try:
            return json.loads(doc.summary)
        except Exception:
            pass
    result = await asyncio.to_thread(summarize_document, doc_id)
    # 실패 결과("요약을 생성할 수 없습니다" 등)는 캐시하지 않는다 — 한 번 실패하면 영영 안 나오던 문제
    if result.get("key_concepts"):
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
        .filter(Document.user_id == x_user_id, Document.group_id.is_(None))
        .order_by(Document.created_at.desc())
        .all()
    )
    return [
        {"doc_id": r.id, "filename": r.filename, "chunks": r.chunks, "folder": r.folder,
         "status": r.status or "done", "created_at": r.created_at.isoformat()}
        for r in rows
    ]
