"""학습 관리 공용 로직: AI JSON 호출, 개념 이해도(약점 지도), 간격 반복(SM-2)."""
import json
import logging
import re
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

_RETRIABLE = ("overload", "503", "429", "rate", "temporarily", "unavailable", "404", "timeout")


def parse_json(text: str):
    """무료 모델은 ```json … ``` 이나 앞뒤 설명을 붙이곤 한다 — 첫 JSON 덩어리만 꺼낸다."""
    text = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    for pat in (r"\{.*\}", r"\[.*\]"):
        m = re.search(pat, text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                continue
    return json.loads(text)


def ask_json(prompt: str, validate=None):
    """주 모델 → 예비 모델 순서로 JSON 답을 받는다. validate(data)가 거짓이면 다음 모델."""
    from .rag import _llm, _PRIMARY_MODEL, _FALLBACK_MODELS
    last = None
    for model in [_PRIMARY_MODEL] + _FALLBACK_MODELS:
        try:
            data = parse_json(_llm(model).invoke(prompt).content)
            if validate is None or validate(data):
                return data
            last = ValueError("AI 답 형식이 올바르지 않아요.")
        except Exception as e:  # 무료 모델은 자주 막힌다 — 다음 모델로
            log.warning("ask_json %s failed: %s", model, e)
            last = e
    raise ValueError(f"AI가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요. ({str(last)[:120]})")


def ask_text(prompt: str) -> str:
    from .rag import _llm, _PRIMARY_MODEL, _FALLBACK_MODELS
    last = None
    for model in [_PRIMARY_MODEL] + _FALLBACK_MODELS:
        try:
            out = _llm(model).invoke(prompt).content
            if isinstance(out, list):
                out = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in out)
            if out and out.strip():
                return out.strip()
        except Exception as e:
            log.warning("ask_text %s failed: %s", model, e)
            last = e
    raise ValueError(f"AI가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요. ({str(last)[:120]})")


# ── 자료·권한 ─────────────────────────────────────────

def can_read_doc(db, doc, user_id: str | None) -> bool:
    from ..db.models import StudyGroupMember
    if not doc or not user_id:
        return False
    if doc.user_id == user_id:
        return True
    if doc.group_id:
        return db.query(StudyGroupMember).filter(
            StudyGroupMember.group_id == doc.group_id, StudyGroupMember.user_id == user_id
        ).first() is not None
    return False


def summary_of(doc) -> dict:
    try:
        return json.loads(doc.summary or "{}") or {}
    except Exception:
        return {}


def doc_concepts(doc) -> list[str]:
    """자료의 개념 목록 — 요약의 짧은 개념명(concepts), 없으면 키워드."""
    s = summary_of(doc)
    out = []
    for c in (s.get("concepts") or s.get("keywords") or [])[:10]:
        c = str(c).strip().strip("`")[:60]
        if c and c not in out:
            out.append(c)
    return out


def clean_concept(c) -> str | None:
    c = str(c or "").strip().strip("`\"' ")[:120]
    return c or None


# ── 개념 이해도 ───────────────────────────────────────

def _score(results: list[bool]) -> float:
    """최근 풀이일수록 크게 (최신 → 과거 순으로 들어온다)."""
    w_sum = s = 0.0
    for i, ok in enumerate(results[:8]):
        w = 0.7 ** i
        w_sum += w
        s += w * (1.0 if ok else 0.0)
    return s / w_sum if w_sum else 0.0


def level_of(score: float, n: int) -> str:
    if n == 0:
        return "none"      # 아직 안 풀어봄
    if score >= 0.8 and n >= 2:
        return "good"      # 잘 앎
    if score < 0.5:
        return "weak"      # 모름
    return "mid"           # 헷갈림


def concept_mastery(db, user_id: str, doc_ids: list[str] | None = None) -> list[dict]:
    """[{doc_id, concept, score, level, attempts, correct, last_at}] — 약한 것부터."""
    from ..db.models import ConceptAttempt
    q = db.query(ConceptAttempt).filter(ConceptAttempt.user_id == user_id)
    if doc_ids is not None:
        if not doc_ids:
            return []
        q = q.filter(ConceptAttempt.doc_id.in_(doc_ids))
    rows = q.order_by(ConceptAttempt.created_at.desc()).limit(5000).all()
    groups: dict[tuple, list] = {}
    for r in rows:
        groups.setdefault((r.doc_id, r.concept), []).append(r)
    out = []
    for (doc_id, concept), rs in groups.items():
        results = [r.correct for r in rs]
        sc = _score(results)
        out.append({
            "doc_id": doc_id, "concept": concept, "score": round(sc, 2),
            "level": level_of(sc, len(rs)), "attempts": len(rs), "correct": sum(results),
            "last_at": rs[0].created_at.isoformat() if rs[0].created_at else None,
        })
    order = {"weak": 0, "mid": 1, "good": 2, "none": 3}
    out.sort(key=lambda x: (order[x["level"]], x["score"], -x["attempts"]))
    return out


def record_attempt(db, user_id: str | None, doc_id: str | None, concept: str | None, correct: bool, source: str):
    from ..db.models import ConceptAttempt
    concept = clean_concept(concept)
    if not user_id or not concept:
        return
    db.add(ConceptAttempt(user_id=user_id, doc_id=doc_id, concept=concept[:200], correct=bool(correct), source=source))


def weak_concepts(db, user_id: str, doc_id: str, limit: int = 5) -> list[str]:
    return [m["concept"] for m in concept_mastery(db, user_id, [doc_id]) if m["level"] in ("weak", "mid")][:limit]


# ── 간격 반복 (SM-2 단순화) ────────────────────────────

GRADES = {0: "다시", 1: "어려움", 2: "알맞음", 3: "쉬움"}


def next_schedule(ease: int, interval: int, reps: int, grade: int) -> tuple[int, int, int]:
    """(ease×100, interval일, reps) — grade 0 다시 / 1 어려움 / 2 알맞음 / 3 쉬움"""
    ef = ease / 100
    if grade == 0:
        return max(130, int((ef - 0.2) * 100)), 0, 0
    if reps == 0:
        iv = {1: 1, 2: 1, 3: 3}[grade]
    elif reps == 1:
        iv = {1: 2, 2: 3, 3: 6}[grade]
    else:
        mult = {1: 1.2, 2: ef, 3: ef * 1.3}[grade]
        iv = max(interval + 1, round(interval * mult))
    ef = ef + {1: -0.15, 2: 0.0, 3: 0.15}[grade]
    return max(130, min(350, int(ef * 100))), min(iv, 365), reps + 1


def preview_intervals(card) -> dict:
    return {g: next_schedule(card.ease, card.interval, card.reps, g)[1] for g in GRADES}


def due_after(interval: int, now: datetime | None = None) -> datetime:
    now = now or datetime.utcnow()
    return now + (timedelta(minutes=10) if interval == 0 else timedelta(days=interval))
