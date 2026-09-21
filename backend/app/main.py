import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import AuthenticationError, RateLimitError

from .api.documents import router as doc_router
from .api.qa import router as qa_router
from .api.quiz import router as quiz_router
from .db.models import Base  # noqa: F401
from .db.session import engine

Base.metadata.create_all(bind=engine)

app = FastAPI(title="StudyRAG API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimitError)
async def handle_rate_limit(request: Request, exc: RateLimitError):
    msg = (
        "OpenAI 크레딧이 부족합니다. "
        "platform.openai.com/settings/organization/billing 에서 충전 후 다시 시도하세요."
        if "credit_balance_exhausted" in str(exc) or "insufficient_quota" in str(exc)
        else "API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요."
    )
    return JSONResponse(status_code=402, content={"detail": msg})


@app.exception_handler(AuthenticationError)
async def handle_auth_error(request: Request, exc: AuthenticationError):
    return JSONResponse(
        status_code=401,
        content={"detail": "OpenAI API 키가 올바르지 않습니다. .env 파일을 확인하세요."},
    )


@app.exception_handler(Exception)
async def handle_general(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.include_router(doc_router)
app.include_router(qa_router)
app.include_router(quiz_router)


@app.get("/health")
def health():
    return {"status": "ok"}


_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
