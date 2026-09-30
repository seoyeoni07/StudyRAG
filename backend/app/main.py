import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from .api.documents import router as doc_router
from .api.qa import router as qa_router
from .api.quiz import router as quiz_router
from .api.tutor import router as tutor_router
from .api.rooms import router as rooms_router
from .db.models import Base  # noqa: F401
from .db.session import engine

app = FastAPI(title="StudyRAG API", version="0.1.0")


@app.on_event("startup")
async def startup():
    try:
        Base.metadata.create_all(bind=engine)
        print("[DB] tables ready", flush=True)
    except Exception as e:
        print(f"[DB] init error: {e}", flush=True)

    # 기존 테이블에 새 컬럼 추가 (IF NOT EXISTS — 멱등성 보장)
    _migrations = [
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary TEXT",
        "ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS reviewed BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS next_review TIMESTAMP",
        "ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder VARCHAR(64)",
    ]
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            for sql in _migrations:
                try:
                    conn.execute(text(sql))
                except Exception:
                    pass  # 이미 존재하면 무시
            conn.commit()
        print("[DB] migrations applied", flush=True)
    except Exception as e:
        print(f"[DB] migration error: {e}", flush=True)

    try:
        from .core.rag import _get_embedding
        _get_embedding()
        print("[Embed] model ready", flush=True)
    except Exception as e:
        print(f"[Embed] preload error: {e}", flush=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

CORS_HEADERS = {"Access-Control-Allow-Origin": "*"}

@app.exception_handler(Exception)
async def handle_general(request: Request, exc: Exception):
    print(f"[ERROR] {request.method} {request.url.path}: {exc}", flush=True)
    return JSONResponse(status_code=500, content={"detail": str(exc)}, headers=CORS_HEADERS)


app.include_router(doc_router)
app.include_router(qa_router)
app.include_router(quiz_router)
app.include_router(tutor_router)
app.include_router(rooms_router)


@app.get("/health")
def health():
    return {"status": "ok"}


_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
