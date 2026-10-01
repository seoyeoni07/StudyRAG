from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from ..core.config import settings

def _engine_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://") and "+psycopg2" not in url:
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url

_url = _engine_url(settings.db_connection_string.strip())
_connect_args = {"check_same_thread": False} if "sqlite" in _url else {}
# Supabase 세션 풀러(5432)는 동시 연결이 15개로 제한된다.
# 앱 전체(일반 DB + 벡터 검색)가 이 엔진 하나를 같이 쓰고, 최대 8개까지만 연다.
_pool_args = {} if "sqlite" in _url else {
    "pool_size": 5,
    "max_overflow": 3,
    "pool_pre_ping": True,   # 끊긴 연결 재사용 방지
    "pool_recycle": 300,
}
engine = create_engine(_url, connect_args=_connect_args, **_pool_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass
