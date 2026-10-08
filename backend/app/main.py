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
from .api.notes import router as notes_router
from .api.groups import router as groups_router
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
        "CREATE EXTENSION IF NOT EXISTS vector",  # 벡터 검색용 — 요청마다 만들지 않고 시작할 때 한 번
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary TEXT",
        "ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS reviewed BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS next_review TIMESTAMP",
        "ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder VARCHAR(64)",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS group_id VARCHAR(36)",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'done'",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS error TEXT",
        # 재시작으로 끊긴 백그라운드 인식은 실패로 돌려서 '다시 시도'할 수 있게 한다
        "UPDATE documents SET status = 'failed', error = '서버가 다시 시작되어 인식이 중단됐어요. 다시 시도해주세요.' WHERE status = 'processing'",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS group_id VARCHAR(36)",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS ydoc TEXT",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS last_edited_by VARCHAR(128)",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'code'",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS level VARCHAR(16)",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS subject VARCHAR(64)",
        """CREATE TABLE IF NOT EXISTS tutor_threads (
            id SERIAL PRIMARY KEY,
            doc_id VARCHAR(36) NOT NULL,
            user_id VARCHAR(128),
            role VARCHAR(16) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS qa_threads (
            id SERIAL PRIMARY KEY,
            doc_id VARCHAR(36) NOT NULL,
            user_id VARCHAR(128),
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            sources_json TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )""",
    ]
    try:
        from sqlalchemy import text
        for sql in _migrations:
            # 문장마다 별도 트랜잭션 — Postgres는 한 문장이 실패하면 같은 트랜잭션의 나머지도 실패함
            # SQLite는 ADD COLUMN IF NOT EXISTS를 지원하지 않아 IF NOT EXISTS 없이 한 번 더 시도
            for candidate in (sql, sql.replace("ADD COLUMN IF NOT EXISTS", "ADD COLUMN")):
                try:
                    with engine.begin() as conn:
                        conn.execute(text(candidate))
                    break
                except Exception:
                    pass  # 이미 존재하면 무시
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
app.include_router(notes_router)
app.include_router(groups_router)


@app.get("/health")
def health():
    return {"status": "ok"}


_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
