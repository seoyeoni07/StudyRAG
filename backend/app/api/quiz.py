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
    focus_concept: str | None = None     # 약점 지도: 이 개념만
    context_text: str | None = None      # 자료에서 고른 부분으로만 출제


class ReportRequest(BaseModel):
    session_id: str
    question: str
    issue: str = ""


class ReviewedRequest(BaseModel):
    confidence: int = 2  # 1=어려움, 2=보통, 3=쉬움


class AnswerItem(BaseModel):
    id: int
    answer: str


class GradeRequest(BaseModel):
    session_id: str
    answers: list[AnswerItem]


@router.post("/generate")
async def generate(req: GenerateRequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    # 적응형: 자주 틀린 개념을 퀴즈 생성 힌트로 전달
    weak_hints: list[str] = []
    if req.focus_difficulty:
        from collections import Counter
        wrongs = db.query(WrongAnswer).filter(WrongAnswer.doc_id == req.doc_id).all()
        counts = Counter(w.question for w in wrongs)
        weak_hints = [q for q, _ in counts.most_common(3)]

    from ..core.learning import doc_concepts
    doc = db.query(Document).filter(Document.id == req.doc_id).first()
    concepts = doc_concepts(doc) if doc else []
    try:
        questions = await asyncio.to_thread(
            generate_quiz, req.doc_id, max(1, min(15, req.n)), req.focus_difficulty, weak_hints,
            concepts, (req.focus_concept or "").strip()[:120] or None, req.context_text)
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
async def grade(req: GradeRequest, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    from ..core.learning import record_attempt
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
            feedback = q.get("explanation", "")
        else:
            graded = grade_short_answer(q["question"], correct_ans, user_ans)
            is_correct = graded["correct"]
            feedback = graded["feedback"]

        record_attempt(db, x_user_id, session.doc_id, q.get("concept"), is_correct, "quiz")
        if is_correct:
            correct_count += 1
        else:
            db.add(WrongAnswer(
                doc_id=session.doc_id,
                session_id=req.session_id,
                question=q["question"],
                correct_answer=correct_ans,
                user_answer=user_ans,
                explanation=q.get("explanation", ""),
                concept=(str(q.get("concept") or "")[:200] or None),
            ))

        results.append({
            "id": q["id"],
            "correct": is_correct,
            "correct_answer": correct_ans,
            "explanation": feedback,
            "user_answer": user_ans,
            "concept": q.get("concept"),
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
            "reviewed": r.reviewed,
            "next_review": r.next_review.isoformat() if r.next_review else None,
            "review_count": r.review_count or 0,
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


@router.post("/wrong-answers/{item_id}/explain")
async def explain_wrong_answer(item_id: int, db: Session = Depends(get_db)):
    """RAG + LLM으로 오답 해설 생성 후 저장."""
    item = db.get(WrongAnswer, item_id)
    if not item:
        raise HTTPException(404, "항목을 찾을 수 없습니다.")

    from ..core.rag import get_vectorstore, _llm
    from langchain_core.output_parsers import StrOutputParser

    # 관련 컨텍스트 검색
    context = ""
    try:
        vs = get_vectorstore(item.doc_id)
        docs = vs.as_retriever(search_kwargs={"k": 3}).invoke(item.question)
        context = "\n".join(d.page_content[:400] for d in docs)
    except Exception:
        pass

    prompt = (
        f"문제: {item.question}\n"
        f"정답: {item.correct_answer}\n"
        f"학생 답변: {item.user_answer or '(미입력)'}\n"
        + (f"참고 자료:\n{context[:1200]}\n" if context else "")
        + "\n학생이 왜 틀렸는지 설명하고 올바른 개념을 3~4문장으로 친절하게 한국어로 해설해주세요."
    )

    try:
        result = await asyncio.to_thread(_llm().invoke, prompt)
        explanation = result.content.strip()
    except Exception:
        explanation = f"정답은 '{item.correct_answer}'입니다. 관련 내용을 다시 복습해보세요."

    item.explanation = explanation
    db.commit()
    return {"explanation": explanation}


@router.patch("/wrong-answers/{item_id}/reviewed")
def toggle_reviewed(item_id: int, req: ReviewedRequest = ReviewedRequest(), db: Session = Depends(get_db)):
    item = db.get(WrongAnswer, item_id)
    if not item:
        raise HTTPException(404)
    item.reviewed = not item.reviewed
    if item.reviewed:
        count = item.review_count or 0
        # confidence: 1=어려움(리셋), 2=보통, 3=쉬움(한 단계 앞으로)
        if req.confidence == 1:
            idx = 0
        elif req.confidence == 3:
            idx = min(count + 1, len(_REVIEW_INTERVALS) - 1)
        else:
            idx = min(count, len(_REVIEW_INTERVALS) - 1)
        item.next_review = datetime.utcnow() + timedelta(days=_REVIEW_INTERVALS[idx])
        item.review_count = count + 1
    else:
        item.next_review = None
    db.commit()
    return {"reviewed": item.reviewed, "next_review": item.next_review.isoformat() if item.next_review else None}


@router.post("/retry-wrongs")
def retry_wrongs(doc_id: str, db: Session = Depends(get_db)):
    wrongs = (
        db.query(WrongAnswer)
        .filter(WrongAnswer.doc_id == doc_id, WrongAnswer.reviewed == False)
        .order_by(WrongAnswer.created_at.desc())
        .limit(15)
        .all()
    )
    if not wrongs:
        raise HTTPException(404, "복습할 오답이 없습니다.")

    questions = [
        {
            "id": i + 1,
            "type": "short_answer",
            "question": w.question,
            "answer": w.correct_answer,
            "explanation": w.explanation or f"정답은 '{w.correct_answer}'입니다.",
            "concept": w.concept,
        }
        for i, w in enumerate(wrongs)
    ]

    session_id = str(uuid.uuid4())
    db.add(QuizSession(
        id=session_id,
        doc_id=doc_id,
        questions_json=json.dumps(questions, ensure_ascii=False),
    ))
    db.commit()

    public = [{"id": q["id"], "type": q["type"], "question": q["question"]} for q in questions]
    return {"session_id": session_id, "questions": public, "is_retry": True}


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

    # 자료별 평균 + 숙련도(최근 세션 가중) + 기억 유지율
    import math
    now_dt = datetime.utcnow()

    by_doc: dict[str, dict] = {}
    sessions_by_doc: dict[str, list] = {}
    for h in all_history:
        s = by_doc.setdefault(h.doc_id, {"total": 0, "correct": 0, "sessions": 0})
        s["total"] += h.total; s["correct"] += h.correct; s["sessions"] += 1
        sessions_by_doc.setdefault(h.doc_id, []).append(h)

    # 숙련도: 최근 5회 세션을 지수 가중 평균 (최신 = 높은 가중치)
    mastery_by_doc: dict[str, int] = {}
    for did, hist in sessions_by_doc.items():
        hist.sort(key=lambda h: h.created_at)
        recent = hist[-5:]
        ws = [0.4, 0.6, 0.75, 0.875, 1.0][-len(recent):]
        w_sum = sum(ws)
        mastery_by_doc[did] = round(
            sum(w * (h.correct / h.total) for w, h in zip(ws, recent) if h.total) / w_sum * 100
        ) if w_sum else 0

    # 기억 유지율: 에빙하우스 망각곡선 R = e^(-t/S) 로 각 오답 추정 후 평균
    wrongs_by_doc: dict[str, list] = {}
    for w in all_wrongs:
        wrongs_by_doc.setdefault(w.doc_id, []).append(w)

    retention_by_doc: dict[str, int] = {}
    for did in doc_ids:
        doc_wrongs = wrongs_by_doc.get(did, [])
        if not doc_wrongs:
            retention_by_doc[did] = 100
            continue
        r_sum = 0.0
        for w in doc_wrongs:
            days = max(0, (now_dt - w.created_at).total_seconds() / 86400)
            # stability: 복습 횟수에 따라 안정화 (SM-2 근사: S ≈ review_count * 3 + 1)
            stability = (w.review_count or 0) * 3 + 1
            r = math.exp(-days / stability)
            r_sum += max(0.0, min(1.0, r))
        retention_by_doc[did] = round(r_sum / len(doc_wrongs) * 100)

    doc_stats = [
        {
            "doc_id": did,
            "name": doc_name.get(did, "?"),
            "avg_pct": round(s["correct"] / s["total"] * 100) if s["total"] else 0,
            "sessions": s["sessions"],
            "mastery_pct": mastery_by_doc.get(did, 0),
            "retention_pct": retention_by_doc.get(did, 100),
        }
        for did, s in by_doc.items()
    ]

    avg_mastery = round(sum(d["mastery_pct"] for d in doc_stats) / len(doc_stats)) if doc_stats else 0
    avg_retention = round(sum(d["retention_pct"] for d in doc_stats) / len(doc_stats)) if doc_stats else 100

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
        "avg_mastery_pct": avg_mastery,
        "avg_retention_pct": avg_retention,
        "total_wrongs": len(all_wrongs),
        "total_docs": len(docs),
        "recent_sessions": recent_sessions,
        "doc_stats": doc_stats,
        "difficulty_stats": difficulty_stats,
        "weak_concepts": weak_concepts,
    }
