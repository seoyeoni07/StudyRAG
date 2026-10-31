"""개념 약점 지도 + 플래시카드(간격 반복)."""
import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.learning import (
    GRADES, ask_json, can_read_doc, concept_mastery, doc_concepts, due_after, next_schedule,
    preview_intervals, record_attempt, summary_of,
)
from ..db.models import Document, Flashcard, Note, NoteShare, StudyGroupMember, WrongAnswer
from ..db.session import SessionLocal

router = APIRouter(prefix="/learn", tags=["learn"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    return x_user_id


def _doc(db: Session, doc_id: str, user_id: str) -> Document:
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not can_read_doc(db, d, user_id):
        raise HTTPException(404, "자료를 찾을 수 없습니다.")
    return d


def _my_doc_ids(db: Session, user_id: str) -> dict[str, Document]:
    """내 개인 자료 + 내가 속한 그룹의 자료"""
    gids = [m.group_id for m in db.query(StudyGroupMember).filter(StudyGroupMember.user_id == user_id).all()]
    q = db.query(Document).filter(Document.user_id == user_id, Document.group_id.is_(None)).all()
    if gids:
        q += db.query(Document).filter(Document.group_id.in_(gids)).all()
    return {d.id: d for d in q}


# ── 개념 약점 지도 ─────────────────────────────────────

@router.get("/mastery")
def mastery(doc_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """자료 하나의 개념별 이해도. 요약의 개념 중 아직 안 풀어본 것은 level=none."""
    user_id = _user(x_user_id)
    d = _doc(db, doc_id, user_id)
    s = summary_of(d)
    rows = concept_mastery(db, user_id, [doc_id])
    seen = {r["concept"] for r in rows}
    for c in doc_concepts(d):
        if c not in seen:
            rows.append({"doc_id": doc_id, "concept": c, "score": 0, "level": "none", "attempts": 0, "correct": 0, "last_at": None})
    wrong_by = {}
    for w in db.query(WrongAnswer).filter(WrongAnswer.doc_id == doc_id, WrongAnswer.reviewed == False).all():  # noqa: E712
        if w.concept:
            wrong_by[w.concept] = wrong_by.get(w.concept, 0) + 1
    due_by = {}
    for c in db.query(Flashcard).filter(Flashcard.user_id == user_id, Flashcard.doc_id == doc_id,
                                        Flashcard.due <= datetime.utcnow()).all():
        if c.concept:
            due_by[c.concept] = due_by.get(c.concept, 0) + 1
    for r in rows:
        r["wrongs"] = wrong_by.get(r["concept"], 0)
        r["cards_due"] = due_by.get(r["concept"], 0)
    counts = {k: sum(1 for r in rows if r["level"] == k) for k in ("good", "mid", "weak", "none")}
    return {"doc_id": doc_id, "concepts": rows, "counts": counts, "has_summary": bool(s.get("key_concepts"))}


@router.get("/weak")
def weak(limit: int = 10, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """전체 자료에서 약한 개념 (학습 통계·플래너용)."""
    user_id = _user(x_user_id)
    docs = _my_doc_ids(db, user_id)
    rows = [r for r in concept_mastery(db, user_id, list(docs)) if r["level"] in ("weak", "mid")]
    for r in rows:
        d = docs.get(r["doc_id"])
        r["filename"] = d.filename if d else None
        r["group_id"] = d.group_id if d else None
    return rows[:max(1, min(50, limit))]


# ── 플래시카드 ─────────────────────────────────────────

def _card(c: Flashcard) -> dict:
    return {
        "id": c.id, "doc_id": c.doc_id, "note_id": c.note_id, "concept": c.concept,
        "front": c.front, "back": c.back, "page": c.page, "source": c.source,
        "interval": c.interval, "reps": c.reps, "lapses": c.lapses,
        "due": c.due.isoformat() if c.due else None,
        "is_due": bool(c.due and c.due <= datetime.utcnow()),
        "next": preview_intervals(c),
    }


@router.get("/cards")
def list_cards(doc_id: str | None = None, note_id: str | None = None, due: bool = False, limit: int = 200,
               x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    q = db.query(Flashcard).filter(Flashcard.user_id == user_id)
    if doc_id:
        q = q.filter(Flashcard.doc_id == doc_id)
    if note_id:
        q = q.filter(Flashcard.note_id == note_id)
    if due:
        q = q.filter(Flashcard.due <= datetime.utcnow()).order_by(Flashcard.due)
    else:
        q = q.order_by(Flashcard.created_at.desc())
    return [_card(c) for c in q.limit(max(1, min(500, limit))).all()]


@router.get("/cards/summary")
def cards_summary(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """오늘 복습할 카드 수 (사이드바 배지) + 자료·노트별 묶음."""
    user_id = _user(x_user_id)
    now = datetime.utcnow()
    cards = db.query(Flashcard).filter(Flashcard.user_id == user_id).all()
    docs = {d.id: d for d in db.query(Document).filter(Document.id.in_({c.doc_id for c in cards if c.doc_id})).all()} if cards else {}
    notes = {n.id: n for n in db.query(Note).filter(Note.id.in_({c.note_id for c in cards if c.note_id})).all()} if cards else {}
    groups: dict[str, dict] = {}
    for c in cards:
        if c.doc_id:
            key, label, kind = f"doc:{c.doc_id}", (docs[c.doc_id].filename if c.doc_id in docs else "삭제된 자료"), "doc"
        elif c.note_id:
            key, label, kind = f"note:{c.note_id}", ((notes[c.note_id].title or "제목 없음") if c.note_id in notes else "삭제된 노트"), "note"
        else:
            key, label, kind = "etc", "직접 만든 카드", "etc"
        g = groups.setdefault(key, {"key": key, "kind": kind, "id": c.doc_id or c.note_id, "label": label, "total": 0, "due": 0})
        g["total"] += 1
        g["due"] += 1 if c.due and c.due <= now else 0
    return {"due": sum(g["due"] for g in groups.values()), "total": len(cards),
            "groups": sorted(groups.values(), key=lambda g: (-g["due"], g["label"]))}


class CardIn(BaseModel):
    front: str
    back: str
    doc_id: str | None = None
    note_id: str | None = None
    concept: str | None = None
    page: int | None = None
    source: str = "user"


def _check_target(db: Session, user_id: str, doc_id: str | None, note_id: str | None):
    if doc_id:
        _doc(db, doc_id, user_id)
    if note_id:
        n = db.query(Note).filter(Note.id == note_id).first()
        ok = n and (n.user_id == user_id or
                    (n.group_id and db.query(StudyGroupMember).filter(StudyGroupMember.group_id == n.group_id,
                                                                     StudyGroupMember.user_id == user_id).first()) or
                    db.query(NoteShare).filter(NoteShare.note_id == note_id, NoteShare.shared_with == user_id).first())
        if not ok:
            raise HTTPException(404, "노트를 찾을 수 없습니다.")
        return n
    return None


@router.post("/cards")
def add_card(body: CardIn, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    if not body.front.strip() or not body.back.strip():
        raise HTTPException(400, "앞면과 뒷면을 모두 써주세요.")
    _check_target(db, user_id, body.doc_id, body.note_id)
    c = Flashcard(user_id=user_id, doc_id=body.doc_id, note_id=body.note_id, front=body.front.strip()[:2000],
                  back=body.back.strip()[:4000], concept=(body.concept or "").strip()[:200] or None,
                  page=body.page, source=body.source if body.source in ("user", "selection", "ai") else "user")
    db.add(c)
    db.commit()
    return _card(c)


class GenerateCards(BaseModel):
    doc_id: str | None = None
    note_id: str | None = None
    text: str | None = None       # 자료에서 고른 부분
    concept: str | None = None    # 이 개념만
    page: int | None = None
    n: int = 8


_CARDS_PROMPT = """너는 대학생 암기 카드(플래시카드) 출제자야. 아래 내용으로 카드 {n}장을 만들어.

규칙:
- 앞면: 짧은 질문이나 용어 (예: "스택의 특징은?", "LIFO란?"). 뒷면: 1~3문장의 정확한 답.
- 한 카드에 한 가지만. 내용에 없는 것은 지어내지 마.
- concept: 그 카드가 다루는 개념 이름 (2~15글자).{concept_rule}

내용:
{context}

반드시 이 JSON으로만 답해:
{{"cards": [{{"front": "앞면", "back": "뒷면", "concept": "개념"}}]}}"""


def _gen_cards(context: str, n: int, concepts: list[str], focus: str | None) -> list[dict]:
    rule = ""
    if focus:
        rule = f" 모든 카드를 '{focus}' 개념으로 만들고 concept 값은 '{focus}'."
    elif concepts:
        rule = " 가능하면 다음 이름 중 하나를 그대로: " + ", ".join(concepts[:10])
    data = ask_json(_CARDS_PROMPT.format(n=n, context=context[:7000], concept_rule=rule),
                    validate=lambda d: isinstance(d, (dict, list)) and (d.get("cards") if isinstance(d, dict) else d))
    cards = data["cards"] if isinstance(data, dict) else data
    out = []
    for c in cards:
        if isinstance(c, dict) and str(c.get("front", "")).strip() and str(c.get("back", "")).strip():
            out.append({"front": str(c["front"]).strip()[:2000], "back": str(c["back"]).strip()[:4000],
                        "concept": focus or (str(c.get("concept") or "").strip()[:200] or None)})
    return out[:n]


@router.post("/cards/generate")
async def generate_cards(body: GenerateCards, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """자료·노트·고른 문장으로 카드를 만든다 (무료 AI라 30초~1분)."""
    user_id = _user(x_user_id)
    n = max(1, min(20, body.n))
    concepts: list[str] = []
    if body.text and body.text.strip():
        context = body.text
        if body.doc_id:
            concepts = doc_concepts(_doc(db, body.doc_id, user_id))
    elif body.note_id:
        note = _check_target(db, user_id, None, body.note_id)
        context = f"제목: {note.title}\n\n{note.content or ''}"
        if len((note.content or "").strip()) < 20:
            raise HTTPException(400, "노트 내용이 너무 짧아서 카드를 만들 수 없어요.")
    elif body.doc_id:
        d = _doc(db, body.doc_id, user_id)
        concepts = doc_concepts(d)
        from ..core.rag import get_vectorstore
        query = body.concept or "핵심 개념 정의 특징"
        hits = await asyncio.to_thread(
            lambda: get_vectorstore(body.doc_id).as_retriever(search_type="mmr", search_kwargs={"k": 10, "fetch_k": 30}).invoke(query))
        if not hits:
            raise HTTPException(409, "자료 내용을 찾지 못했어요.")
        context = "\n\n---\n\n".join(h.page_content for h in hits)
    else:
        raise HTTPException(400, "자료나 노트를 골라주세요.")
    try:
        made = await asyncio.to_thread(_gen_cards, context, n, concepts, (body.concept or "").strip() or None)
    except ValueError as e:
        raise HTTPException(503, str(e))
    if not made:
        raise HTTPException(503, "카드를 만들지 못했어요. 잠시 후 다시 시도해주세요.")
    rows = [Flashcard(user_id=user_id, doc_id=body.doc_id, note_id=body.note_id, page=body.page,
                      source="selection" if body.text else "ai", **c) for c in made]
    db.add_all(rows)
    db.commit()
    return [_card(c) for c in rows]


class CardEdit(BaseModel):
    front: str | None = None
    back: str | None = None
    concept: str | None = None


def _own_card(db: Session, card_id: int, user_id: str) -> Flashcard:
    c = db.query(Flashcard).filter(Flashcard.id == card_id, Flashcard.user_id == user_id).first()
    if not c:
        raise HTTPException(404, "카드를 찾을 수 없습니다.")
    return c


@router.patch("/cards/{card_id}")
def edit_card(card_id: int, body: CardEdit, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    c = _own_card(db, card_id, _user(x_user_id))
    if body.front is not None and body.front.strip():
        c.front = body.front.strip()[:2000]
    if body.back is not None and body.back.strip():
        c.back = body.back.strip()[:4000]
    if body.concept is not None:
        c.concept = body.concept.strip()[:200] or None
    db.commit()
    return _card(c)


@router.delete("/cards/{card_id}")
def delete_card(card_id: int, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    c = _own_card(db, card_id, _user(x_user_id))
    db.delete(c)
    db.commit()
    return {"ok": True}


class ReviewIn(BaseModel):
    grade: int   # 0 다시 / 1 어려움 / 2 알맞음 / 3 쉬움


@router.post("/cards/{card_id}/review")
def review_card(card_id: int, body: ReviewIn, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    if body.grade not in GRADES:
        raise HTTPException(400, "grade는 0~3이에요.")
    c = _own_card(db, card_id, user_id)
    now = datetime.utcnow()
    c.ease, c.interval, c.reps = next_schedule(c.ease, c.interval, c.reps, body.grade)
    if body.grade == 0:
        c.lapses += 1
    c.due, c.last_review = due_after(c.interval, now), now
    # 카드 복습도 약점 지도에 반영 (어려움 이상 = 앎)
    record_attempt(db, user_id, c.doc_id, c.concept, body.grade >= 1, "card")
    db.commit()
    return _card(c)
