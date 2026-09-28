import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from .api.documents import router as doc_router
from .api.qa import router as qa_router
from .api.quiz import router as quiz_router
from .api.tutor import router as tutor_router
from .db.models import Base  # noqa: F401
from .db.session import engine
from .core.config import settings

# 연결 문자열 로그 (비밀번호 마스킹)
import re as _re
_masked = _re.sub(r'(:)[^@]+(@)', r'\1***\2', settings.db_connection_string)
print(f"[DB] connecting to: {_masked}", flush=True)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="StudyRAG API", version="0.1.0")


@app.on_event("startup")
async def preload_model():
    from .core.rag import _get_embedding
    _get_embedding()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def handle_general(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.include_router(doc_router)
app.include_router(qa_router)
app.include_router(quiz_router)
app.include_router(tutor_router)


@app.get("/health")
def health():
    return {"status": "ok"}


_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
