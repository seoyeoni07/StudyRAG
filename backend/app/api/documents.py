import os
import shutil
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..core.parser import chunk_text, extract_text
from ..core.rag import add_chunks

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    if not (file.filename or "").endswith(".pdf"):
        raise HTTPException(400, "PDF 파일만 업로드 가능합니다.")

    doc_id = str(uuid.uuid4())
    save_path = f"{UPLOAD_DIR}/{doc_id}.pdf"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    text = extract_text(save_path)
    if not text.strip():
        os.remove(save_path)
        raise HTTPException(422, "텍스트를 추출할 수 없습니다. 이미지 기반 PDF는 지원하지 않습니다.")

    chunks = chunk_text(text)
    add_chunks(
        doc_id,
        chunks,
        [{"doc_id": doc_id, "chunk_idx": i} for i in range(len(chunks))],
    )

    return {"doc_id": doc_id, "filename": file.filename, "chunks": len(chunks)}
