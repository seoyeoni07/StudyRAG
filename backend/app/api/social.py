from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db.models import Friendship, Post, PostLike, UserProfile, Note, Document, QuizHistory
from ..db.session import SessionLocal

router = APIRouter(prefix="/social", tags=["social"])


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


def _calc_streak(user_id: str, db: Session) -> int:
    today = datetime.now(timezone.utc).date()
    active_dates: set = set()
    for (dt,) in db.query(QuizHistory.created_at).join(Document, QuizHistory.doc_id == Document.id).filter(Document.user_id == user_id).all():
        if dt:
            active_dates.add(dt.date() if hasattr(dt, "date") else dt)
    for (dt,) in db.query(Note.updated_at).filter(Note.user_id == user_id).all():
        if dt:
            active_dates.add(dt.date() if hasattr(dt, "date") else dt)
    streak = 0
    check = today
    while check in active_dates:
        streak += 1
        check -= timedelta(days=1)
    return streak


def _friendship_status(me: str, uid: str, db: Session):
    """Returns (friendship_row_or_None, status_string)"""
    row = db.query(Friendship).filter(
        or_(
            (Friendship.requester_id == me) & (Friendship.addressee_id == uid),
            (Friendship.requester_id == uid) & (Friendship.addressee_id == me),
        )
    ).first()
    if not row:
        return None, "none"
    return row, row.status


def _profile_dict(p: UserProfile, me: str, db: Session) -> dict:
    row, status = _friendship_status(me, p.uid, db)
    streak = _calc_streak(p.uid, db)
    notes_count = db.query(Note).filter(Note.user_id == p.uid, Note.visibility == "public").count()
    friends_count = db.query(Friendship).filter(
        or_(Friendship.requester_id == p.uid, Friendship.addressee_id == p.uid),
        Friendship.status == "accepted",
    ).count()
    sent_by_me = row.requester_id == me if row else False
    return {
        "uid": p.uid,
        "display_name": p.display_name or p.email,
        "photo_url": p.photo_url,
        "streak": streak,
        "public_notes_count": notes_count,
        "friends_count": friends_count,
        "friendship_id": row.id if row else None,
        "friendship_status": status,  # none | pending | accepted | denied
        "sent_by_me": sent_by_me,
    }


# ── 프로필 ───────────────────────────────────────────────────────────────────

@router.get("/profile/{uid}")
def get_profile(uid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    p = db.query(UserProfile).filter(UserProfile.uid == uid).first()
    if not p:
        raise HTTPException(404, "사용자를 찾을 수 없어요.")
    return _profile_dict(p, me, db)


@router.get("/profile/{uid}/notes")
def get_profile_notes(uid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_user(x_user_id)
    notes = db.query(Note).filter(Note.user_id == uid, Note.visibility == "public").order_by(Note.updated_at.desc()).limit(20).all()
    return [{"id": n.id, "title": n.title or "제목 없음", "icon": n.icon, "updated_at": n.updated_at.isoformat() if n.updated_at else None} for n in notes]


# ── 친구 ─────────────────────────────────────────────────────────────────────

@router.post("/friend-request/{uid}")
def send_friend_request(uid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    if me == uid:
        raise HTTPException(400, "자신에게는 친구 요청을 보낼 수 없어요.")
    existing = db.query(Friendship).filter(
        or_(
            (Friendship.requester_id == me) & (Friendship.addressee_id == uid),
            (Friendship.requester_id == uid) & (Friendship.addressee_id == me),
        )
    ).first()
    if existing:
        if existing.status == "accepted":
            raise HTTPException(400, "이미 친구예요.")
        if existing.status == "pending":
            raise HTTPException(400, "이미 요청이 있어요.")
        # denied → re-request
        existing.requester_id = me
        existing.addressee_id = uid
        existing.status = "pending"
        existing.updated_at = datetime.utcnow()
        db.commit()
        return {"id": existing.id, "status": "pending"}
    row = Friendship(requester_id=me, addressee_id=uid)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "status": "pending"}


@router.get("/friend-requests")
def get_friend_requests(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    rows = db.query(Friendship).filter(Friendship.addressee_id == me, Friendship.status == "pending").all()
    result = []
    for r in rows:
        p = db.query(UserProfile).filter(UserProfile.uid == r.requester_id).first()
        result.append({
            "id": r.id,
            "from_uid": r.requester_id,
            "display_name": (p.display_name or p.email) if p else r.requester_id[:8],
            "photo_url": p.photo_url if p else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return result


class FriendRequestAction(BaseModel):
    action: str  # accept | deny


@router.patch("/friend-requests/{friendship_id}")
def respond_friend_request(
    friendship_id: int, body: FriendRequestAction,
    x_user_id: str | None = Header(default=None), db: Session = Depends(get_db),
):
    me = _require_user(x_user_id)
    row = db.query(Friendship).filter(Friendship.id == friendship_id, Friendship.addressee_id == me).first()
    if not row:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    if body.action == "accept":
        row.status = "accepted"
    elif body.action == "deny":
        row.status = "denied"
    else:
        raise HTTPException(400, "action은 accept 또는 deny여야 해요.")
    row.updated_at = datetime.utcnow()
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/friends")
def get_friends(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    rows = db.query(Friendship).filter(
        or_(Friendship.requester_id == me, Friendship.addressee_id == me),
        Friendship.status == "accepted",
    ).all()
    result = []
    for r in rows:
        uid = r.addressee_id if r.requester_id == me else r.requester_id
        p = db.query(UserProfile).filter(UserProfile.uid == uid).first()
        result.append({
            "uid": uid,
            "display_name": (p.display_name or p.email) if p else uid[:8],
            "photo_url": p.photo_url if p else None,
            "streak": _calc_streak(uid, db),
        })
    return result


@router.delete("/friends/{uid}")
def unfriend(uid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    row = db.query(Friendship).filter(
        or_(
            (Friendship.requester_id == me) & (Friendship.addressee_id == uid),
            (Friendship.requester_id == uid) & (Friendship.addressee_id == me),
        ),
        Friendship.status == "accepted",
    ).first()
    if not row:
        raise HTTPException(404, "친구 관계를 찾을 수 없어요.")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ── 게시글 ───────────────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    content: str


def _post_dict(post: Post, me: str, db: Session) -> dict:
    p = db.query(UserProfile).filter(UserProfile.uid == post.user_id).first()
    likes = db.query(PostLike).filter(PostLike.post_id == post.id).count()
    liked = db.query(PostLike).filter(PostLike.post_id == post.id, PostLike.user_id == me).first() is not None
    return {
        "id": post.id,
        "user_id": post.user_id,
        "display_name": (p.display_name or p.email) if p else post.user_id[:8],
        "photo_url": p.photo_url if p else None,
        "content": post.content,
        "likes": likes,
        "liked_by_me": liked,
        "created_at": post.created_at.isoformat() if post.created_at else None,
    }


@router.post("/posts")
def create_post(body: PostCreate, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    if not body.content.strip():
        raise HTTPException(400, "내용을 입력해주세요.")
    post = Post(user_id=me, content=body.content.strip())
    db.add(post)
    db.commit()
    db.refresh(post)
    return _post_dict(post, me, db)


@router.get("/feed")
def get_feed(offset: int = 0, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    friend_rows = db.query(Friendship).filter(
        or_(Friendship.requester_id == me, Friendship.addressee_id == me),
        Friendship.status == "accepted",
    ).all()
    friend_ids = {r.addressee_id if r.requester_id == me else r.requester_id for r in friend_rows}
    friend_ids.add(me)
    posts = (
        db.query(Post)
        .filter(Post.user_id.in_(friend_ids))
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(20)
        .all()
    )
    return [_post_dict(p, me, db) for p in posts]


@router.get("/posts/user/{uid}")
def get_user_posts(uid: str, offset: int = 0, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    posts = db.query(Post).filter(Post.user_id == uid).order_by(Post.created_at.desc()).offset(offset).limit(20).all()
    return [_post_dict(p, me, db) for p in posts]


@router.post("/posts/{post_id}/like")
def toggle_like(post_id: int, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    existing = db.query(PostLike).filter(PostLike.post_id == post_id, PostLike.user_id == me).first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"liked": False}
    db.add(PostLike(post_id=post_id, user_id=me))
    db.commit()
    return {"liked": True}


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = _require_user(x_user_id)
    post = db.query(Post).filter(Post.id == post_id, Post.user_id == me).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없어요.")
    db.delete(post)
    db.commit()
    return {"ok": True}
