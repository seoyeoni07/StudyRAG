from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db.models import UserProfile
from ..db.session import SessionLocal

router = APIRouter(prefix="/users", tags=["users"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    return x_user_id


class ProfileUpdate(BaseModel):
    email: str | None = None
    display_name: str | None = None


@router.put("/me")
def upsert_profile(body: ProfileUpdate, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    p = db.query(UserProfile).filter(UserProfile.uid == user_id).first()
    if p:
        if body.email is not None:
            p.email = body.email
        if body.display_name is not None:
            p.display_name = body.display_name
        p.updated_at = datetime.utcnow()
    else:
        p = UserProfile(uid=user_id, email=body.email, display_name=body.display_name)
        db.add(p)
    db.commit()
    return {"ok": True}


@router.get("/search")
def search_users(q: str = "", x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    if len(q) < 2:
        return []
    results = (
        db.query(UserProfile)
        .filter(
            UserProfile.uid != user_id,
            or_(UserProfile.email.ilike(f"%{q}%"), UserProfile.display_name.ilike(f"%{q}%")),
        )
        .limit(10)
        .all()
    )
    return [{"uid": r.uid, "email": r.email, "display_name": r.display_name or r.email} for r in results]
