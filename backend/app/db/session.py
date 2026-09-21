from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from ..core.config import settings

_connect_args = {"check_same_thread": False} if "sqlite" in settings.db_connection_string else {}
engine = create_engine(settings.db_connection_string, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass
