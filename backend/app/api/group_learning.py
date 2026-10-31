"""그룹 스터디: 서로 문제 내기(AI 품질 검토) · 주간 랭킹."""
import asyncio
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.learning import ask_json, record_attempt
from ..db.models import (
    Document, GroupQuestion, GroupQuestionAttempt, Planner, PlannerDay, PlannerTask, StudyGroup, StudyGroupMember,
)
from ..db.session import SessionLocal
from .groups import _name_map, _require_user, require_member

router = APIRouter(prefix="/groups", tags=["group-learning"])


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


def _q_out(q: GroupQuestion, names: dict, mine: GroupQuestionAttempt | None, stats: dict, me: str) -> dict:
    revealed = mine is not None or q.author_id == me
    return {
        "id": q.id, "doc_id": q.doc_id, "type": q.qtype, "question": q.question,
        "options": _loads(q.options, None), "concept": q.concept,
        "author_id": q.author_id, "author_name": names.get(q.author_id, "나간 멤버"),
        "answer": q.answer if revealed else None,
        "explanation": q.explanation if revealed else None,
        "ai_review": _loads(q.ai_review, None),
        "my_attempt": {"answer": mine.answer, "correct": mine.correct, "feedback": mine.feedback} if mine else None,
        "attempts": stats.get("n", 0), "correct_rate": round(stats["ok"] / stats["n"], 2) if stats.get("n") else None,
        "created_at": q.created_at.isoformat() if q.created_at else None,
    }


@router.get("/{group_id}/questions")
def list_questions(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    names = _name_map(db, group_id)
    qs = db.query(GroupQuestion).filter(GroupQuestion.group_id == group_id).order_by(GroupQuestion.created_at.desc()).limit(200).all()
    ids = [q.id for q in qs]
    attempts = db.query(GroupQuestionAttempt).filter(GroupQuestionAttempt.question_id.in_(ids)).all() if ids else []
    stats, mine = {}, {}
    for a in attempts:
        s = stats.setdefault(a.question_id, {"n": 0, "ok": 0})
        s["n"] += 1
        s["ok"] += 1 if a.correct else 0
        if a.user_id == user_id:
            mine[a.question_id] = a
    return [_q_out(q, names, mine.get(q.id), stats.get(q.id, {}), user_id) for q in qs]


class QuestionIn(BaseModel):
    type: str = "short"            # mc | short
    question: str
    options: list[str] | None = None
    answer: str
    explanation: str | None = None
    concept: str | None = None
    doc_id: str | None = None


_REVIEW_PROMPT = """너는 대학 조교야. 스터디원이 낸 문제를 검토해.
{material}
문제 유형: {qtype}
문제: {question}
{options}
출제자 정답: {answer}
해설: {explanation}

평가:
- answer_ok: 출제자 정답이 맞는지 (true/false)
- score: 문제 품질 1~5 (명확성·난이도 적절성·개념 확인에 좋은지)
- verdict: 한 줄 총평
- comments: 고치면 좋은 점 1~3개 (짧게). 정답이 틀렸으면 올바른 답을 알려줘.

반드시 이 JSON으로만 답해:
{{"answer_ok": true, "score": 4, "verdict": "…", "comments": ["…"]}}"""


def _review_bg(question_id: int):
    db = SessionLocal()
    try:
        q = db.query(GroupQuestion).filter(GroupQuestion.id == question_id).first()
        if not q:
            return
        material = ""
        if q.doc_id:
            try:
                from ..core.rag import get_vectorstore
                hits = get_vectorstore(q.doc_id).similarity_search(q.question, k=3)
                material = "참고 자료:\n" + "\n---\n".join(h.page_content for h in hits)[:3000] + "\n"
            except Exception:
                pass
        opts = _loads(q.options, None)
        prompt = _REVIEW_PROMPT.format(
            material=material, qtype="객관식" if q.qtype == "mc" else "단답·서술형", question=q.question,
            options=("선택지: " + " / ".join(opts)) if opts else "", answer=q.answer, explanation=q.explanation or "없음")
        try:
            r = ask_json(prompt, lambda d: isinstance(d, dict) and "score" in d)
            review = {"answer_ok": bool(r.get("answer_ok", True)), "score": max(1, min(5, int(r.get("score") or 3))),
                      "verdict": str(r.get("verdict") or "")[:200], "comments": [str(c)[:200] for c in (r.get("comments") or [])][:3]}
        except Exception as e:
            review = {"error": f"AI 검토를 못 했어요 ({str(e)[:80]})"}
        q.ai_review = json.dumps(review, ensure_ascii=False)
        db.commit()
    finally:
        db.close()


@router.post("/{group_id}/questions")
def create_question(group_id: str, body: QuestionIn, background: BackgroundTasks,
                    x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """문제는 바로 올라가고, AI 품질 검토는 뒤에서 (30초~1분) 붙는다."""
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    qtype = "mc" if body.type == "mc" else "short"
    question, answer = body.question.strip(), body.answer.strip()
    if not question or not answer:
        raise HTTPException(400, "문제와 정답을 써주세요.")
    opts = None
    if qtype == "mc":
        opts = [o.strip()[:300] for o in (body.options or []) if o.strip()]
        if len(opts) < 2:
            raise HTTPException(400, "객관식은 선택지를 2개 이상 써주세요.")
        if answer not in opts:
            raise HTTPException(400, "정답은 선택지 중 하나여야 해요.")
    if body.doc_id:
        d = db.query(Document).filter(Document.id == body.doc_id, Document.group_id == group_id).first()
        if not d:
            raise HTTPException(400, "이 그룹의 자료만 연결할 수 있어요.")
    q = GroupQuestion(group_id=group_id, doc_id=body.doc_id, author_id=user_id, qtype=qtype, question=question[:3000],
                      options=json.dumps(opts, ensure_ascii=False) if opts else None, answer=answer[:2000],
                      explanation=(body.explanation or "").strip()[:3000] or None,
                      concept=(body.concept or "").strip()[:200] or None)
    db.add(q)
    db.commit()
    background.add_task(_review_bg, q.id)
    return _q_out(q, _name_map(db, group_id), None, {}, user_id)


class AttemptIn(BaseModel):
    answer: str


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


@router.post("/{group_id}/questions/{qid}/attempt")
async def attempt(group_id: str, qid: int, body: AttemptIn, x_user_id: str | None = Header(default=None),
                  db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    q = db.query(GroupQuestion).filter(GroupQuestion.id == qid, GroupQuestion.group_id == group_id).first()
    if not q:
        raise HTTPException(404, "문제를 찾을 수 없습니다.")
    if q.author_id == user_id:
        raise HTTPException(400, "내가 낸 문제는 풀 수 없어요.")
    if db.query(GroupQuestionAttempt).filter(GroupQuestionAttempt.question_id == qid, GroupQuestionAttempt.user_id == user_id).first():
        raise HTTPException(409, "이미 푼 문제예요.")
    ans = body.answer.strip()[:2000]
    if not ans:
        raise HTTPException(400, "답을 써주세요.")
    feedback = None
    if q.qtype == "mc":
        correct = ans == q.answer
    elif _norm(ans) == _norm(q.answer):
        correct = True
    else:
        from ..core.quiz import grade_short_answer
        try:
            g = await asyncio.to_thread(grade_short_answer, q.question, q.answer, ans)
            correct, feedback = bool(g.get("correct")), g.get("feedback")
        except Exception:
            correct, feedback = False, "AI 채점이 잠시 안 돼서 정확히 일치하는지만 봤어요."
    db.add(GroupQuestionAttempt(question_id=qid, user_id=user_id, answer=ans, correct=correct, feedback=feedback))
    record_attempt(db, user_id, q.doc_id, q.concept, correct, "peer")
    db.commit()
    return {"correct": correct, "feedback": feedback, "answer": q.answer, "explanation": q.explanation}


@router.delete("/{group_id}/questions/{qid}")
def delete_question(group_id: str, qid: int, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    q = db.query(GroupQuestion).filter(GroupQuestion.id == qid, GroupQuestion.group_id == group_id).first()
    if not q:
        raise HTTPException(404, "문제를 찾을 수 없습니다.")
    g = db.query(StudyGroup).filter(StudyGroup.id == group_id).first()
    if q.author_id != user_id and (not g or g.owner_id != user_id):
        raise HTTPException(403, "낸 사람이나 그룹장만 지울 수 있어요.")
    db.query(GroupQuestionAttempt).filter(GroupQuestionAttempt.question_id == qid).delete()
    db.delete(q)
    db.commit()
    return {"ok": True}


# ── 주간 랭킹 ──────────────────────────────────────────

def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


@router.get("/{group_id}/ranking")
def ranking(group_id: str, start: str | None = None, x_user_id: str | None = Header(default=None),
            db: Session = Depends(get_db)):
    """이번 주(월~일) 멤버별: 플래너에 칠한 '실제' 공부 시간, 끝낸 할 일, 푼 문제·맞힌 문제, 낸 문제."""
    user_id = _require_user(x_user_id)
    require_member(db, group_id, user_id)
    try:
        ws = _week_start(date.fromisoformat(start) if start else date.today())
    except ValueError:
        raise HTTPException(400, "날짜 형식이 올바르지 않아요.")
    we = ws + timedelta(days=6)
    keys = [(ws + timedelta(days=i)).isoformat() for i in range(7)]
    members = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == group_id).all()
    uids = [m.user_id for m in members]
    planners = {p.owner_id: p.id for p in db.query(Planner).filter(Planner.owner_type == "user", Planner.owner_id.in_(uids)).all()}
    minutes = {u: 0 for u in uids}
    daily = {u: {k: 0 for k in keys} for u in uids}
    if planners:
        owner_of = {pid: u for u, pid in planners.items()}
        for d in db.query(PlannerDay).filter(PlannerDay.planner_id.in_(list(planners.values())), PlannerDay.date.in_(keys)).all():
            done = sum(1 for v in _loads(d.timeline, {}).values() if isinstance(v, dict) and v.get("k") == "done") * 10
            u = owner_of[d.planner_id]
            minutes[u] += done
            daily[u][d.date] = done
    tasks_done = {u: 0 for u in uids}
    if planners:
        owner_of = {pid: u for u, pid in planners.items()}
        for t in db.query(PlannerTask).filter(PlannerTask.planner_id.in_(list(planners.values())), PlannerTask.date.in_(keys),
                                              PlannerTask.done == True).all():  # noqa: E712
            tasks_done[owner_of[t.planner_id]] += 1
    t0, t1 = datetime.combine(ws, datetime.min.time()), datetime.combine(we + timedelta(days=1), datetime.min.time())
    qids = [q.id for q in db.query(GroupQuestion.id).filter(GroupQuestion.group_id == group_id).all()]
    solved = {u: [0, 0] for u in uids}
    if qids:
        for a in db.query(GroupQuestionAttempt).filter(GroupQuestionAttempt.question_id.in_(qids),
                                                       GroupQuestionAttempt.created_at >= t0, GroupQuestionAttempt.created_at < t1).all():
            if a.user_id in solved:
                solved[a.user_id][0] += 1
                solved[a.user_id][1] += 1 if a.correct else 0
    made = {u: 0 for u in uids}
    for q in db.query(GroupQuestion).filter(GroupQuestion.group_id == group_id, GroupQuestion.created_at >= t0,
                                            GroupQuestion.created_at < t1).all():
        if q.author_id in made:
            made[q.author_id] += 1
    rows = [{
        "user_id": m.user_id, "name": m.display_name, "minutes": minutes[m.user_id], "daily": [daily[m.user_id][k] for k in keys],
        "tasks_done": tasks_done[m.user_id], "solved": solved[m.user_id][0], "correct": solved[m.user_id][1],
        "made": made[m.user_id],
        # 점수: 공부 1시간 = 10점, 맞힌 문제 2점, 낸 문제 3점, 끝낸 할 일 1점
        "points": minutes[m.user_id] // 6 + solved[m.user_id][1] * 2 + made[m.user_id] * 3 + tasks_done[m.user_id],
    } for m in members]
    rows.sort(key=lambda r: (-r["points"], -r["minutes"], r["name"] or ""))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return {"start": ws.isoformat(), "end": we.isoformat(), "days": keys, "rows": rows}
