"""그룹 역량 평가: 자료로 만든 같은 문제로 사전·사후 평가, 그룹장이 기간을 정하고 CSV로 결과를 받는다.

- 사전 평가 뒤에는 점수만 보여주고 정답은 숨긴다 (같은 문제라 정답을 알면 외워서 푼다).
- 문제·보기 순서는 사람·단계마다 섞는다 (위치 기억 방지).
- 문제마다 확신도(확실/애매/찍음)를 받아 '아는 걸 아는지'(메타인지)도 잰다.
"""
import asyncio
import csv
import hashlib
import io
import json
import random
import uuid
from datetime import date, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.learning import ask_json
from ..db.models import (
    Assessment, AssessmentAttempt, ConceptAttempt, Document, Planner, PlannerDay, StudyGroup, StudyGroupMember,
)
from ..db.session import SessionLocal
from .groups import _name_map, _require_user, require_member

router = APIRouter(prefix="/groups", tags=["assessments"])

DIFFS = ["기본", "응용", "심화"]
CONF = ("sure", "unsure", "guess")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _loads(s, default):
    try:
        return json.loads(s) if s else default
    except Exception:
        return default


def kst_today() -> str:
    return (datetime.utcnow() + timedelta(hours=9)).date().isoformat()


def _kst_date(dt: datetime | None) -> str | None:
    return (dt + timedelta(hours=9)).date().isoformat() if dt else None


def _window(open_: str | None, close: str | None, today: str) -> str:
    """before | open | closed"""
    if not open_:
        return "before"
    if today < open_:
        return "before"
    if close and today > close:
        return "closed"
    return "open"


def _is_owner(db: Session, group_id: str, user_id: str) -> bool:
    g = db.query(StudyGroup).filter(StudyGroup.id == group_id).first()
    return bool(g and g.owner_id == user_id)


def _get(db: Session, group_id: str, aid: str, user_id: str) -> tuple[Assessment, bool]:
    require_member(db, group_id, user_id)
    a = db.query(Assessment).filter(Assessment.id == aid, Assessment.group_id == group_id).first()
    owner = _is_owner(db, group_id, user_id)
    if not a or (a.status != "open" and not owner):
        raise HTTPException(404, "평가를 찾을 수 없습니다.")
    return a, owner


def _owner_only(owner: bool):
    if not owner:
        raise HTTPException(403, "그룹장만 할 수 있어요.")


def _check_dates(pre_open, pre_close, post_open, post_close):
    for d in (pre_open, pre_close, post_open, post_close):
        if d:
            try:
                date.fromisoformat(d)
            except ValueError:
                raise HTTPException(400, "날짜 형식이 올바르지 않아요.")
    if not pre_open or not post_open:
        raise HTTPException(400, "사전 평가 시작일과 사후 평가 시작일을 정해주세요.")
    if pre_close and pre_close < pre_open:
        raise HTTPException(400, "사전 평가 마감일이 시작일보다 빨라요.")
    if post_open <= pre_open:
        raise HTTPException(400, "사후 평가는 사전 평가보다 뒤에 시작해야 해요.")
    if pre_close and post_open <= pre_close:
        raise HTTPException(400, "사후 평가는 사전 평가 마감 다음 날부터 열 수 있어요.")
    if post_close and post_close < post_open:
        raise HTTPException(400, "사후 평가 마감일이 시작일보다 빨라요.")


# ── 채점 ───────────────────────────────────────────────

def _score(a: Assessment, att: AssessmentAttempt | None) -> dict | None:
    """채점에서 뺀 문항은 사전·사후 모두에서 뺀다 (공정한 비교)."""
    if not att:
        return None
    qs = [q for q in _loads(a.questions, []) if q["id"] not in set(_loads(a.excluded, []))]
    ans = _loads(att.answers, {})
    correct, by_diff = 0, {d: [0, 0] for d in DIFFS}
    sure_n = sure_ok = calib = conf_n = 0
    items = {}
    for q in qs:
        r = ans.get(str(q["id"])) or {}
        ok = r.get("c") == q["answer"]
        correct += ok
        d = q.get("difficulty") if q.get("difficulty") in DIFFS else "응용"
        by_diff[d][0] += ok
        by_diff[d][1] += 1
        f = r.get("f")
        if f in CONF:
            conf_n += 1
            # 확신 일치: 확실한데 맞힘 / 확실하지 않은데 틀림
            calib += (f == "sure" and ok) or (f != "sure" and not ok)
            if f == "sure":
                sure_n += 1
                sure_ok += ok
        items[q["id"]] = {"ok": ok, "c": r.get("c"), "f": f}
    total = len(qs)
    return {
        "correct": correct, "total": total, "pct": round(correct / total * 100, 1) if total else 0,
        "by_diff": {d: {"correct": v[0], "total": v[1]} for d, v in by_diff.items()},
        "calibration": round(calib / conf_n * 100, 1) if conf_n else None,     # 확신-정답 일치율
        "sure_accuracy": round(sure_ok / sure_n * 100, 1) if sure_n else None, # '확실' 답의 정답률
        "items": items, "seconds": att.seconds,
        "submitted_at": att.submitted_at.isoformat() if att.submitted_at else None,
    }


def gain(pre: float, post: float) -> float | None:
    """향상도 = (사후 − 사전) ÷ (100 − 사전). 사전이 만점이면 계산하지 않는다."""
    return round((post - pre) / (100 - pre), 3) if pre < 100 else None


# ── 문제 만들기 ────────────────────────────────────────

_GEN_PROMPT = """너는 대학 강의 평가 문항 출제자야. 아래 강의자료로 학습 성취도를 재는 4지선다 문제 {n}개를 만들어.

규칙:
- 난이도 구성: 기본 {nb}개(용어·정의), 응용 {na}개(개념을 상황에 적용), 심화 {ns}개(비교·분석·추론).
- 자료에 근거한 내용만. 정답이 하나로 분명해야 하고, 오답 보기는 그럴듯하게.
- 여러 개념을 고르게 다루고, 같은 내용을 반복하지 마.
- '모두 고르시오', '옳지 않은 것은 모두' 같은 형식은 쓰지 마.
- options는 보기 4개 (번호·기호 없이 내용만). answer는 정답 보기의 순서 0~3.
- page: 근거가 된 자료 페이지 (본문의 [자료번호 p.N] 표시). 모르면 null. doc: 자료번호.
{avoid}
강의자료:
{context}

반드시 이 JSON으로만 답해:
{{"questions": [{{"question": "문제", "options": ["보기1", "보기2", "보기3", "보기4"], "answer": 0,
"explanation": "해설", "difficulty": "기본", "concept": "개념 이름(2~15글자)", "doc": 1, "page": 3}}]}}"""


def _material(doc_ids: list[str], k_total: int = 16) -> str:
    from ..core.rag import get_vectorstore
    per = max(3, k_total // max(1, len(doc_ids)))
    parts = []
    for i, d in enumerate(doc_ids, 1):
        try:
            hits = get_vectorstore(d).as_retriever(search_type="mmr", search_kwargs={"k": per, "fetch_k": per * 4}).invoke(
                "강의 핵심 개념 정의 원리 비교")
            parts += [f"[{i} p.{h.metadata.get('page')}] {h.page_content}" for h in hits]
        except Exception:
            pass
    return "\n\n---\n\n".join(parts)[:12000]


def _clean_option(o) -> str:
    s = str(o).strip()
    for pre in ("A.", "B.", "C.", "D.", "A)", "B)", "C)", "D)", "①", "②", "③", "④", "1.", "2.", "3.", "4."):
        if s.startswith(pre):
            return s[len(pre):].strip()
    return s


def _normalize(raw: list, doc_ids: list[str]) -> list[dict]:
    out = []
    for q in raw:
        if not isinstance(q, dict) or not str(q.get("question", "")).strip():
            continue
        opts = [_clean_option(o) for o in (q.get("options") or [])][:4]
        if len(opts) != 4 or len(set(opts)) != 4 or not all(opts):
            continue
        ans = q.get("answer")
        if isinstance(ans, str):
            s = ans.strip()
            ans = "ABCD".index(s[0].upper()) if s and s[0].upper() in "ABCD" else (opts.index(_clean_option(s)) if _clean_option(s) in opts else None)
        if not isinstance(ans, int) or not 0 <= ans <= 3:
            continue
        doc_no = q.get("doc")
        page = q.get("page")
        out.append({
            "question": str(q["question"]).strip()[:1500], "options": [o[:400] for o in opts], "answer": ans,
            "explanation": str(q.get("explanation") or "")[:1500],
            "difficulty": q.get("difficulty") if q.get("difficulty") in DIFFS else "응용",
            "concept": str(q.get("concept") or "")[:60] or None,
            "doc_id": doc_ids[doc_no - 1] if isinstance(doc_no, int) and 1 <= doc_no <= len(doc_ids) else (doc_ids[0] if len(doc_ids) == 1 else None),
            "page": page if isinstance(page, int) else None,
        })
    return out


def generate_questions(doc_ids: list[str], n: int, avoid: list[str] | None = None, only: str | None = None) -> list[dict]:
    context = _material(doc_ids)
    if not context.strip():
        raise ValueError("자료 내용을 찾지 못했어요.")
    if only:
        nb, na, ns = (n if only == "기본" else 0), (n if only == "응용" else 0), (n if only == "심화" else 0)
    else:
        nb, ns = round(n * 0.3), round(n * 0.3)
        na = n - nb - ns
    avoid_txt = ("- 다음 문제들과 겹치지 않게:\n" + "\n".join(f"  · {a[:80]}" for a in avoid[:25]) + "\n") if avoid else ""
    got: list[dict] = []
    for _ in range(2):   # 모자라면 한 번 더
        need = n - len(got)
        if need <= 0:
            break
        data = ask_json(_GEN_PROMPT.format(n=need, nb=min(nb, need), na=min(na, need), ns=max(0, need - min(nb, need) - min(na, need)),
                                           context=context, avoid=avoid_txt),
                        lambda d: isinstance(d, dict) and isinstance(d.get("questions"), list))
        seen = {q["question"] for q in got} | set(avoid or [])
        for q in _normalize(data["questions"], doc_ids):
            if q["question"] not in seen:
                got.append(q)
                seen.add(q["question"])
    return got[:n]


# ── 목록·만들기·수정 (그룹장) ────────────────────────

def _summary(db: Session, a: Assessment, user_id: str, owner: bool) -> dict:
    today = kst_today()
    mine = {t.phase: t for t in db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id,
                                                                  AssessmentAttempt.user_id == user_id).all()}
    pre, post = _score(a, mine.get("pre")), _score(a, mine.get("post"))
    out = {
        "id": a.id, "title": a.title, "status": a.status, "doc_ids": _loads(a.doc_ids, []),
        "n": len([q for q in _loads(a.questions, []) if q["id"] not in set(_loads(a.excluded, []))]),
        "pre_open": a.pre_open, "pre_close": a.pre_close, "post_open": a.post_open, "post_close": a.post_close,
        "pre_window": _window(a.pre_open, a.pre_close, today), "post_window": _window(a.post_open, a.post_close, today),
        "today": today,
        "my_pre": {k: pre[k] for k in ("correct", "total", "pct", "submitted_at")} if pre else None,
        "my_post": {k: post[k] for k in ("correct", "total", "pct", "submitted_at")} if post else None,
        "is_owner": owner,
    }
    # 지금 할 일: pre | post | wait_post | done | missed
    if pre and post:
        out["todo"] = "done"
    elif not pre:
        out["todo"] = "pre" if out["pre_window"] == "open" else ("missed" if out["pre_window"] == "closed" else "wait_pre")
    else:
        out["todo"] = "post" if out["post_window"] == "open" else ("missed" if out["post_window"] == "closed" else "wait_post")
    if owner:
        rows = db.query(AssessmentAttempt.phase).filter(AssessmentAttempt.assessment_id == a.id).all()
        out["counts"] = {"pre": sum(1 for r in rows if r[0] == "pre"), "post": sum(1 for r in rows if r[0] == "post"),
                         "members": db.query(StudyGroupMember).filter(StudyGroupMember.group_id == a.group_id).count()}
    return out


@router.get("/{group_id}/assessments")
def list_assessments(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    owner = _is_owner(db, group_id, user_id)
    q = db.query(Assessment).filter(Assessment.group_id == group_id)
    if not owner:
        q = q.filter(Assessment.status == "open")
    return [_summary(db, a, user_id, owner) for a in q.order_by(Assessment.created_at.desc()).all()]


class AssessmentIn(BaseModel):
    title: str
    doc_ids: list[str]
    n: int = 10
    pre_open: str
    pre_close: str | None = None
    post_open: str
    post_close: str | None = None


@router.post("/{group_id}/assessments")
async def create_assessment(group_id: str, body: AssessmentIn, x_user_id: str | None = Header(default=None),
                            db: Session = Depends(get_db)):
    """그룹장이 만든다. AI가 문제를 만드는 데 1~2분. 만든 뒤 미리보기에서 고치고 '공개'해야 멤버에게 보인다."""
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    _owner_only(_is_owner(db, group_id, user_id))
    _check_dates(body.pre_open, body.pre_close, body.post_open, body.post_close)
    docs = [d for d in db.query(Document).filter(Document.id.in_(body.doc_ids[:8]), Document.group_id == group_id).all()
            if (d.status or "done") == "done" and d.chunks]
    if not docs:
        raise HTTPException(400, "평가 범위로 쓸 그룹 자료를 하나 이상 골라주세요.")
    n = max(5, min(20, body.n))
    ids = [d.id for d in docs]
    try:
        qs = await asyncio.to_thread(generate_questions, ids, n)
    except ValueError as e:
        raise HTTPException(503, str(e))
    if len(qs) < max(3, n // 2):
        raise HTTPException(503, "문제를 충분히 만들지 못했어요. 잠시 후 다시 시도해주세요.")
    for i, q in enumerate(qs, 1):
        q["id"] = i
    a = Assessment(id=str(uuid.uuid4()), group_id=group_id, title=(body.title.strip() or "역량 평가")[:128],
                   doc_ids=json.dumps(ids), questions=json.dumps(qs, ensure_ascii=False), excluded="[]", status="draft",
                   pre_open=body.pre_open, pre_close=body.pre_close or None, post_open=body.post_open,
                   post_close=body.post_close or None, created_by=user_id)
    db.add(a)
    db.commit()
    return _detail(db, a, user_id, True)


def _detail(db: Session, a: Assessment, user_id: str, owner: bool) -> dict:
    out = _summary(db, a, user_id, owner)
    if owner:   # 그룹장은 정답 포함 전체 문항 (미리보기·검토용)
        out["questions"] = _loads(a.questions, [])
        out["excluded"] = _loads(a.excluded, [])
        out["locked"] = db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id).first() is not None
        docs = {d.id: d.filename for d in db.query(Document).filter(Document.id.in_(_loads(a.doc_ids, []))).all()}
        out["docs"] = [{"doc_id": i, "filename": docs.get(i)} for i in _loads(a.doc_ids, [])]
    return out


@router.get("/{group_id}/assessments/{aid}")
def get_assessment(group_id: str, aid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    return _detail(db, a, user_id, owner)


class AssessmentEdit(BaseModel):
    title: str | None = None
    pre_open: str | None = None
    pre_close: str | None = None
    post_open: str | None = None
    post_close: str | None = None
    status: str | None = None          # open (공개)
    excluded: list[int] | None = None  # 채점에서 뺄 문항


@router.patch("/{group_id}/assessments/{aid}")
def edit_assessment(group_id: str, aid: str, body: AssessmentEdit, x_user_id: str | None = Header(default=None),
                    db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    _owner_only(owner)
    f = body.model_dump(exclude_unset=True)
    if "title" in f and (f["title"] or "").strip():
        a.title = f["title"].strip()[:128]
    if any(k in f for k in ("pre_open", "pre_close", "post_open", "post_close")):
        po, pc = f.get("pre_open", a.pre_open), f.get("pre_close", a.pre_close)
        qo, qc = f.get("post_open", a.post_open), f.get("post_close", a.post_close)
        _check_dates(po, pc or None, qo, qc or None)
        a.pre_open, a.pre_close, a.post_open, a.post_close = po, pc or None, qo, qc or None
    if f.get("status") == "open":
        a.status = "open"
    if "excluded" in f and f["excluded"] is not None:
        ids = {q["id"] for q in _loads(a.questions, [])}
        ex = sorted({i for i in f["excluded"] if i in ids})
        if len(ex) >= len(ids):
            raise HTTPException(400, "문항을 모두 뺄 수는 없어요.")
        a.excluded = json.dumps(ex)
    db.commit()
    return _detail(db, a, user_id, owner)


@router.post("/{group_id}/assessments/{aid}/questions/{qid}/replace")
async def replace_question(group_id: str, aid: str, qid: int, x_user_id: str | None = Header(default=None),
                           db: Session = Depends(get_db)):
    """미리보기에서 마음에 안 드는 문항을 같은 난이도의 새 문항으로 바꾼다 (아무도 응시하기 전에만)."""
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    _owner_only(owner)
    if db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id).first():
        raise HTTPException(409, "이미 응시한 사람이 있어서 문항을 바꿀 수 없어요. 대신 '채점에서 빼기'를 쓰세요.")
    qs = _loads(a.questions, [])
    cur = next((q for q in qs if q["id"] == qid), None)
    if not cur:
        raise HTTPException(404, "문항을 찾을 수 없습니다.")
    try:
        new = await asyncio.to_thread(generate_questions, _loads(a.doc_ids, []), 1, [q["question"] for q in qs], cur.get("difficulty"))
    except ValueError as e:
        raise HTTPException(503, str(e))
    if not new:
        raise HTTPException(503, "새 문항을 만들지 못했어요. 다시 시도해주세요.")
    new[0]["id"] = qid
    a.questions = json.dumps([new[0] if q["id"] == qid else q for q in qs], ensure_ascii=False)
    db.commit()
    return _detail(db, a, user_id, owner)


@router.delete("/{group_id}/assessments/{aid}")
def delete_assessment(group_id: str, aid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    _owner_only(owner)
    db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id).delete()
    db.delete(a)
    db.commit()
    return {"ok": True}


# ── 응시 (멤버) ────────────────────────────────────────

def _paper(a: Assessment, user_id: str, phase: str) -> list[dict]:
    """사람·단계마다 문제와 보기 순서를 섞는다. 보기는 원래 번호(i)를 같이 보낸다."""
    rnd = random.Random(f"{a.id}:{user_id}:{phase}")
    qs = [q for q in _loads(a.questions, []) if q["id"] not in set(_loads(a.excluded, []))]
    rnd.shuffle(qs)
    out = []
    for q in qs:
        order = list(range(len(q["options"])))
        rnd.shuffle(order)
        out.append({"id": q["id"], "question": q["question"], "options": [{"i": i, "text": q["options"][i]} for i in order]})
    return out


@router.get("/{group_id}/assessments/{aid}/paper")
def get_paper(group_id: str, aid: str, phase: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    a, _ = _get(db, group_id, aid, user_id)
    _check_can_take(db, a, user_id, phase)
    return {"phase": phase, "title": a.title, "questions": _paper(a, user_id, phase)}


def _check_can_take(db: Session, a: Assessment, user_id: str, phase: str):
    if phase not in ("pre", "post"):
        raise HTTPException(400, "phase는 pre 또는 post예요.")
    if a.status != "open":
        raise HTTPException(409, "아직 공개되지 않은 평가예요.")
    today = kst_today()
    w = _window(a.pre_open, a.pre_close, today) if phase == "pre" else _window(a.post_open, a.post_close, today)
    if w == "before":
        raise HTTPException(409, f"{'사전' if phase == 'pre' else '사후'} 평가는 {a.pre_open if phase == 'pre' else a.post_open}부터 볼 수 있어요.")
    if w == "closed":
        raise HTTPException(409, "응시 기간이 끝났어요.")
    done = {t.phase for t in db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id,
                                                               AssessmentAttempt.user_id == user_id).all()}
    if phase in done:
        raise HTTPException(409, "이미 제출했어요.")
    if phase == "post" and "pre" not in done:
        raise HTTPException(409, "사전 평가를 보지 않아서 사후 평가 대상이 아니에요.")


class SubmitIn(BaseModel):
    phase: str
    answers: dict[str, dict]     # {"문항id": {"c": 원래 보기 번호, "f": "sure"|"unsure"|"guess"}}
    seconds: int | None = None


@router.post("/{group_id}/assessments/{aid}/submit")
def submit(group_id: str, aid: str, body: SubmitIn, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    a, _ = _get(db, group_id, aid, user_id)
    _check_can_take(db, a, user_id, body.phase)
    ids = {str(q["id"]) for q in _loads(a.questions, [])}
    clean = {}
    for k, v in body.answers.items():
        if k in ids and isinstance(v, dict):
            c = v.get("c")
            clean[k] = {"c": c if isinstance(c, int) and 0 <= c <= 3 else None, "f": v.get("f") if v.get("f") in CONF else None}
    att = AssessmentAttempt(assessment_id=a.id, user_id=user_id, phase=body.phase, answers=json.dumps(clean),
                            seconds=max(0, min(36000, body.seconds)) if body.seconds is not None else None)
    db.add(att)
    db.commit()
    s = _score(a, att)
    # 사전: 점수만 (정답은 사후 평가 뒤에 공개)
    return {"phase": body.phase, "correct": s["correct"], "total": s["total"], "pct": s["pct"]}


@router.get("/{group_id}/assessments/{aid}/result")
def my_result(group_id: str, aid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """사후 평가까지 끝냈거나 사후 기간이 끝나면 정답·해설과 사전·사후 비교."""
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    mine = {t.phase: t for t in db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id,
                                                                  AssessmentAttempt.user_id == user_id).all()}
    pre, post = _score(a, mine.get("pre")), _score(a, mine.get("post"))
    reveal = bool(post) or _window(a.post_open, a.post_close, kst_today()) == "closed"
    if not reveal:
        return {"reveal": False, "pre": pre and {k: pre[k] for k in ("correct", "total", "pct")}}
    excluded = set(_loads(a.excluded, []))
    qs = []
    for q in _loads(a.questions, []):
        if q["id"] in excluded:
            continue
        qs.append({**q, "pre": pre["items"].get(q["id"]) if pre else None, "post": post["items"].get(q["id"]) if post else None})
    strip = lambda s: s and {k: v for k, v in s.items() if k != "items"}  # noqa: E731
    return {"reveal": True, "pre": strip(pre), "post": strip(post), "questions": qs,
            "gain": gain(pre["pct"], post["pct"]) if pre and post else None}


# ── 결과 (그룹장): 요약 · CSV ─────────────────────────

def _pairs(db: Session, a: Assessment) -> dict[str, dict]:
    rows = db.query(AssessmentAttempt).filter(AssessmentAttempt.assessment_id == a.id).all()
    by: dict[str, dict] = {}
    for r in rows:
        by.setdefault(r.user_id, {})[r.phase] = r
    return by


@router.get("/{group_id}/assessments/{aid}/report")
def report(group_id: str, aid: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    _owner_only(owner)
    by = _pairs(db, a)
    names = _name_map(db, group_id)
    people, pre_pcts, post_pcts, gains = [], [], [], []
    qs = [q for q in _loads(a.questions, []) if q["id"] not in set(_loads(a.excluded, []))]
    item = {q["id"]: {"pre": [0, 0], "post": [0, 0]} for q in qs}
    diff = {d: {"pre": [0, 0], "post": [0, 0]} for d in DIFFS}
    calib = {"pre": [], "post": []}
    for uid, ph in by.items():
        pre, post = _score(a, ph.get("pre")), _score(a, ph.get("post"))
        for name, s in (("pre", pre), ("post", post)):
            if not s:
                continue
            for qid, it in s["items"].items():
                item[qid][name][0] += it["ok"]
                item[qid][name][1] += 1
            for d, v in s["by_diff"].items():
                diff[d][name][0] += v["correct"]
                diff[d][name][1] += v["total"]
            if s["calibration"] is not None:
                calib[name].append(s["calibration"])
        if pre and post:
            pre_pcts.append(pre["pct"])
            post_pcts.append(post["pct"])
            g = gain(pre["pct"], post["pct"])
            if g is not None:
                gains.append(g)
        people.append({"name": names.get(uid, "나간 멤버"), "pre": pre and pre["pct"], "post": post and post["pct"]})
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None  # noqa: E731
    rate = lambda v: round(v[0] / v[1] * 100, 1) if v[1] else None  # noqa: E731
    return {
        "paired": len(pre_pcts), "pre_only": sum(1 for p in people if p["pre"] is not None and p["post"] is None),
        "avg_pre": avg(pre_pcts), "avg_post": avg(post_pcts), "avg_gain": round(sum(gains) / len(gains), 3) if gains else None,
        "improved": sum(1 for x, y in zip(pre_pcts, post_pcts) if y > x),
        "by_diff": {d: {"pre": rate(v["pre"]), "post": rate(v["post"])} for d, v in diff.items()},
        "calibration": {"pre": avg(calib["pre"]), "post": avg(calib["post"])},
        "items": [{"id": q["id"], "question": q["question"], "difficulty": q.get("difficulty"), "concept": q.get("concept"),
                   "pre": rate(item[q["id"]]["pre"]), "post": rate(item[q["id"]]["post"])} for q in qs],
        "people": sorted(people, key=lambda p: (p["post"] is None, -(p["post"] or 0))),
    }


def _anon(aid: str, uid: str) -> str:
    return "P" + hashlib.sha1(f"{aid}:{uid}".encode()).hexdigest()[:6].upper()


def _activity(db: Session, a: Assessment, uid: str, start: datetime | None, end: datetime | None) -> dict:
    """사전~사후 사이: 퀴즈로 푼 문제 수·카드 복습 수(평가 범위 자료), 개인 플래너에 칠한 공부 시간."""
    out = {"quiz": 0, "cards": 0, "minutes": 0}
    if not start:
        return out
    end = end or datetime.utcnow()
    for r in db.query(ConceptAttempt).filter(ConceptAttempt.user_id == uid, ConceptAttempt.doc_id.in_(_loads(a.doc_ids, [])),
                                             ConceptAttempt.created_at >= start, ConceptAttempt.created_at <= end).all():
        out["quiz" if r.source in ("quiz", "peer") else "cards"] += 1
    p = db.query(Planner).filter(Planner.owner_type == "user", Planner.owner_id == uid).first()
    if p:
        d0, d1 = _kst_date(start), _kst_date(end)
        for d in db.query(PlannerDay).filter(PlannerDay.planner_id == p.id, PlannerDay.date >= d0, PlannerDay.date <= d1).all():
            out["minutes"] += 10 * sum(1 for v in _loads(d.timeline, {}).values() if isinstance(v, dict) and v.get("k") == "done")
    return out


def _v(s: dict | None, key: str):
    """CSV 칸: 값이 없으면 빈칸 (0은 0으로 남긴다)"""
    v = (s or {}).get(key)
    return "" if v is None else v


def _csv_response(rows: list[list], filename: str) -> Response:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    # 엑셀에서 한글이 안 깨지도록 BOM을 붙인다 (구글 시트도 그대로 열림)
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.get("/{group_id}/assessments/{aid}/export")
def export_csv(group_id: str, aid: str, kind: str = "people", names: bool = False,
               x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """kind=people: 응답자 한 명당 한 줄 / kind=items: 문항 하나당 한 줄. names=1이면 표시 이름 열 추가."""
    user_id = _require_user(x_user_id)
    a, owner = _get(db, group_id, aid, user_id)
    _owner_only(owner)
    by = _pairs(db, a)
    qs = [q for q in _loads(a.questions, []) if q["id"] not in set(_loads(a.excluded, []))]
    safe = "".join(ch for ch in a.title if ch not in '\\/:*?"<>|')[:40] or "평가"

    if kind == "items":
        rows = [["문항", "난이도", "개념", "문제", "정답", "사전_응시", "사전_정답률(%)", "사후_응시", "사후_정답률(%)", "변화(%p)"]]
        for q in qs:
            res = {"pre": [0, 0], "post": [0, 0]}
            for ph in by.values():
                for name in ("pre", "post"):
                    if name in ph:
                        r = _loads(ph[name].answers, {}).get(str(q["id"])) or {}
                        res[name][0] += r.get("c") == q["answer"]
                        res[name][1] += 1
            pr = round(res["pre"][0] / res["pre"][1] * 100, 1) if res["pre"][1] else ""
            po = round(res["post"][0] / res["post"][1] * 100, 1) if res["post"][1] else ""
            rows.append([q["id"], q.get("difficulty"), q.get("concept") or "", q["question"], q["options"][q["answer"]],
                         res["pre"][1], pr, res["post"][1], po, round(po - pr, 1) if pr != "" and po != "" else ""])
        return _csv_response(rows, f"{safe}_문항별.csv")

    member_names = _name_map(db, group_id)
    head = ["응답자"] + (["이름"] if names else []) + [
        "사전_제출일", "사후_제출일", "기간(일)", "사전_점수", "사후_점수", "문항수", "사전(%)", "사후(%)", "변화(%p)", "향상도",
        "사전_기본(%)", "사후_기본(%)", "사전_응용(%)", "사후_응용(%)", "사전_심화(%)", "사후_심화(%)",
        "사전_확신일치(%)", "사후_확신일치(%)", "사전_확실답정답률(%)", "사후_확실답정답률(%)",
        "사전_소요(초)", "사후_소요(초)", "기간중_퀴즈문제수", "기간중_카드복습수", "기간중_공부시간(분)",
    ] + [f"사전_Q{q['id']}" for q in qs] + [f"사후_Q{q['id']}" for q in qs]
    rows = [head]
    pct = lambda s, d: (round(s["by_diff"][d]["correct"] / s["by_diff"][d]["total"] * 100, 1) if s and s["by_diff"][d]["total"] else "")  # noqa: E731
    for uid, ph in sorted(by.items(), key=lambda kv: _anon(a.id, kv[0])):
        pre, post = _score(a, ph.get("pre")), _score(a, ph.get("post"))
        t0 = ph["pre"].submitted_at if "pre" in ph else None
        t1 = ph["post"].submitted_at if "post" in ph else None
        act = _activity(db, a, uid, t0, t1)
        g = gain(pre["pct"], post["pct"]) if pre and post else None
        row = [_anon(a.id, uid)] + ([member_names.get(uid, "")] if names else []) + [
            _kst_date(t0) or "", _kst_date(t1) or "", (t1 - t0).days if t0 and t1 else "",
            pre["correct"] if pre else "", post["correct"] if post else "", len(qs),
            pre["pct"] if pre else "", post["pct"] if post else "",
            round(post["pct"] - pre["pct"], 1) if pre and post else "", g if g is not None else "",
            pct(pre, "기본"), pct(post, "기본"), pct(pre, "응용"), pct(post, "응용"), pct(pre, "심화"), pct(post, "심화"),
            _v(pre, "calibration"), _v(post, "calibration"), _v(pre, "sure_accuracy"), _v(post, "sure_accuracy"),
            _v(pre, "seconds"), _v(post, "seconds"),
            act["quiz"], act["cards"], act["minutes"],
        ]
        row += [("" if not pre else int(pre["items"][q["id"]]["ok"])) for q in qs]
        row += [("" if not post else int(post["items"][q["id"]]["ok"])) for q in qs]
        rows.append(row)
    return _csv_response(rows, f"{safe}_응답자별.csv")
