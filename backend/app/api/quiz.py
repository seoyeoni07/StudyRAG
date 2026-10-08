import asyncio
import json
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.quiz import generate_quiz, grade_short_answer
from ..db.models import Document, QuizHistory, QuizReport, QuizSession, WrongAnswer
from ..db.session import SessionLocal

_REVIEW_INTERVALS = [1, 3, 7, 14, 30]  # 스페이스드 리피티션 간격 (일)

router = APIRouter(prefix="/quiz", tags=["quiz"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class GenerateRequest(BaseModel):
    doc_id: str
    n: int = 5
    focus_difficulty: str | None = None  # 적응형: 집중할 난이도


class ReportRequest(BaseModel):
    session_id: str
    question: str
    issue: str = ""


class AnswerItem(BaseModel):
    id: int
    answer: str


class GradeRequest(BaseModel):
    session_id: str
    answers: list[AnswerItem]


@router.post("/generate")
async def generate(req: GenerateRequest, db: Session = Depends(get_db)):
    try:
        questions = await asyncio.to_thread(generate_quiz, req.doc_id, req.n, req.focus_difficulty)
    except ValueError as e:
        raise HTTPException(404, str(e))

    session_id = str(uuid.uuid4())
    db.add(QuizSession(
        id=session_id,
        doc_id=req.doc_id,
        questions_json=json.dumps(questions, ensure_ascii=False),
    ))
    db.commit()

    # Strip answers before returning to client
    public = []
    for q in questions:
        pq = {"id": q["id"], "type": q["type"], "question": q["question"]}
        if q["type"] == "multiple_choice":
            pq["options"] = q["options"]
        public.append(pq)

    return {"session_id": session_id, "questions": public}


@router.post("/grade")
async def grade(req: GradeRequest, db: Session = Depends(get_db)):
    session = db.get(QuizSession, req.session_id)
    if not session:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    questions: list[dict] = json.loads(session.questions_json)
    user_map = {a.id: a.answer for a in req.answers}

    results = []
    correct_count = 0

    for q in questions:
        user_ans = user_map.get(q["id"], "")
        correct_ans = q["answer"]

        if q["type"] == "multiple_choice":
            is_correct = user_ans.upper().strip() == correct_ans.upper().strip()
            feedback = q["explanation"]
        else:
            graded = grade_short_answer(q["question"], correct_ans, user_ans)
            is_correct = graded["correct"]
            feedback = graded["feedback"]

        if is_correct:
            correct_count += 1
        else:
            db.add(WrongAnswer(
                doc_id=session.doc_id,
                session_id=req.session_id,
                question=q["question"],
                correct_answer=correct_ans,
                user_answer=user_ans,
                explanation=q["explanation"],
            ))

        results.append({
            "id": q["id"],
            "correct": is_correct,
            "correct_answer": correct_ans,
            "explanation": feedback,
            "user_answer": user_ans,
        })

    db.add(QuizHistory(
        doc_id=session.doc_id,
        session_id=req.session_id,
        total=len(questions),
        correct=correct_count,
    ))
    db.commit()

    return {"score": correct_count, "total": len(questions), "results": results}


@router.get("/wrong-answers")
def get_wrong_answers(doc_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(WrongAnswer)
        .filter(WrongAnswer.doc_id == doc_id)
        .order_by(WrongAnswer.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "question": r.question,
            "correct_answer": r.correct_answer,
            "user_answer": r.user_answer,
            "explanation": r.explanation,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/history/{session_id}")
def get_session_detail(session_id: str, db: Session = Depends(get_db)):
    session = db.get(QuizSession, session_id)
    if not session:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    questions: list[dict] = json.loads(session.questions_json)
    wrongs = {
        r.question: r.user_answer
        for r in db.query(WrongAnswer).filter(WrongAnswer.session_id == session_id).all()
    }
    return [
        {
            "id": q["id"],
            "question": q["question"],
            "type": q["type"],
            "correct_answer": q["answer"],
            "user_answer": wrongs.get(q["question"], ""),
            "correct": q["question"] not in wrongs,
            "explanation": q["explanation"],
        }
        for q in questions
    ]


@router.patch("/wrong-answers/{item_id}/reviewed")
def toggle_reviewed(item_id: int, db: Session = Depends(get_db)):
    item = db.get(WrongAnswer, item_id)
    if not item:
        raise HTTPException(404)
    item.reviewed = not item.reviewed
    if item.reviewed:
        # 스페이스드 리피티션: review_count에 따라 다음 복습일 계산
        days = _REVIEW_INTERVALS[min(item.review_count, len(_REVIEW_INTERVALS) - 1)]
        item.next_review = datetime.utcnow() + timedelta(days=days)
        item.review_count = (item.review_count or 0) + 1
    else:
        item.next_review = None
    db.commit()
    return {"reviewed": item.reviewed, "next_review": item.next_review.isoformat() if item.next_review else None}


@router.get("/due-count")
def get_due_count(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not x_user_id:
        return {"count": 0}
    now = datetime.utcnow()
    unreviewed = (
        db.query(WrongAnswer)
        .join(Document, WrongAnswer.doc_id == Document.id)
        .filter(Document.user_id == x_user_id, WrongAnswer.reviewed == False)
        .count()
    )
    due_again = (
        db.query(WrongAnswer)
        .join(Document, WrongAnswer.doc_id == Document.id)
        .filter(
            Document.user_id == x_user_id,
            WrongAnswer.reviewed == True,
            WrongAnswer.next_review <= now,
        )
        .count()
    )
    return {"count": unreviewed + due_again}


@router.post("/report")
def report_question(req: ReportRequest, db: Session = Depends(get_db)):
    db.add(QuizReport(session_id=req.session_id, question=req.question, issue=req.issue))
    db.commit()
    return {"ok": True}


@router.get("/weak-difficulty")
def get_weak_difficulty(doc_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """사용자의 취약 난이도 분석 (적응형 퀴즈용)"""
    # WrongAnswer + QuizSession에서 난이도별 오답률 계산
    sessions = db.query(QuizSession).filter(QuizSession.doc_id == doc_id).all()
    difficulty_wrong: dict[str, int] = {"기본": 0, "응용": 0, "심화": 0}
    difficulty_total: dict[str, int] = {"기본": 0, "응용": 0, "심화": 0}
    wrong_questions = {
        r.question
        for r in db.query(WrongAnswer).filter(WrongAnswer.doc_id == doc_id).all()
    }
    for s in sessions:
        try:
            qs = json.loads(s.questions_json)
            for q in qs:
                d = q.get("difficulty", "기본")
                if d in difficulty_total:
                    difficulty_total[d] += 1
                    if q["question"] in wrong_questions:
                        difficulty_wrong[d] += 1
        except Exception:
            pass
    # 가장 오답률 높은 난이도 반환
    best_weak = max(
        difficulty_total.keys(),
        key=lambda d: (difficulty_wrong[d] / difficulty_total[d]) if difficulty_total[d] > 0 else 0
    )
    return {
        "focus_difficulty": best_weak,
        "stats": {d: {"wrong": difficulty_wrong[d], "total": difficulty_total[d]} for d in difficulty_total},
    }


@router.get("/history")
def get_history(doc_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(QuizHistory)
        .filter(QuizHistory.doc_id == doc_id)
        .order_by(QuizHistory.created_at.desc())
        .all()
    )
    return [
        {
            "session_id": r.session_id,
            "total": r.total,
            "correct": r.correct,
            "score_pct": round(r.correct / r.total * 100) if r.total else 0,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/user-stats")
def get_user_stats(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """사용자 전체 학습 통계 — 모든 자료에 걸친 집계"""
    from collections import Counter
    from ..db.models import Document

    docs = db.query(Document).filter(Document.user_id == x_user_id).all()
    doc_ids = [d.id for d in docs]
    doc_name = {d.id: d.filename.replace(".pdf", "").replace(".PDF", "") for d in docs}

    if not doc_ids:
        return {
            "total_sessions": 0, "avg_score_pct": 0, "total_wrongs": 0, "total_docs": 0,
            "recent_sessions": [], "doc_stats": [], "difficulty_stats": {},
            "weak_concepts": [],
        }

    all_history = (
        db.query(QuizHistory)
        .filter(QuizHistory.doc_id.in_(doc_ids))
        .order_by(QuizHistory.created_at)
        .all()
    )
    all_wrongs = db.query(WrongAnswer).filter(WrongAnswer.doc_id.in_(doc_ids)).all()

    # 전체 요약
    total_q = sum(h.total for h in all_history)
    total_c = sum(h.correct for h in all_history)
    avg_pct = round(total_c / total_q * 100) if total_q else 0

    # 최근 20회 (시간순)
    recent = all_history[-20:]
    recent_sessions = [
        {
            "date": h.created_at.isoformat(),
            "score_pct": round(h.correct / h.total * 100) if h.total else 0,
            "correct": h.correct,
            "total": h.total,
            "doc_name": doc_name.get(h.doc_id, "?"),
        }
        for h in recent
    ]

    # 자료별 평균
    by_doc: dict[str, dict] = {}
    for h in all_history:
        s = by_doc.setdefault(h.doc_id, {"total": 0, "correct": 0, "sessions": 0})
        s["total"] += h.total; s["correct"] += h.correct; s["sessions"] += 1
    doc_stats = [
        {
            "doc_id": did,
            "name": doc_name.get(did, "?"),
            "avg_pct": round(s["correct"] / s["total"] * 100) if s["total"] else 0,
            "sessions": s["sessions"],
        }
        for did, s in by_doc.items()
    ]

    # 난이도별 오답률 (모든 자료 합산)
    sessions = db.query(QuizSession).filter(QuizSession.doc_id.in_(doc_ids)).all()
    wrong_q = {w.question for w in all_wrongs}
    d_wrong: dict[str, int] = {"기본": 0, "응용": 0, "심화": 0}
    d_total: dict[str, int] = {"기본": 0, "응용": 0, "심화": 0}
    for s in sessions:
        try:
            for q in json.loads(s.questions_json):
                d = q.get("difficulty", "기본")
                if d in d_total:
                    d_total[d] += 1
                    if q["question"] in wrong_q:
                        d_wrong[d] += 1
        except Exception:
            pass
    difficulty_stats = {d: {"wrong": d_wrong[d], "total": d_total[d]} for d in d_total}

    # 취약 개념: 오답 빈도 TOP 10
    counts = Counter(w.question for w in all_wrongs)
    weak_concepts = [
        {"question": q[:80], "count": c}
        for q, c in counts.most_common(10)
    ]

    return {
        "total_sessions": len(all_history),
        "avg_score_pct": avg_pct,
        "total_wrongs": len(all_wrongs),
        "total_docs": len(docs),
        "recent_sessions": recent_sessions,
        "doc_stats": doc_stats,
        "difficulty_stats": difficulty_stats,
        "weak_concepts": weak_concepts,
    }
