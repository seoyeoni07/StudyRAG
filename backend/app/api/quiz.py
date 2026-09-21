import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.quiz import generate_quiz, grade_short_answer
from ..db.models import QuizHistory, QuizSession, WrongAnswer
from ..db.session import SessionLocal

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


class AnswerItem(BaseModel):
    id: int
    answer: str


class GradeRequest(BaseModel):
    session_id: str
    answers: list[AnswerItem]


@router.post("/generate")
async def generate(req: GenerateRequest, db: Session = Depends(get_db)):
    try:
        questions = generate_quiz(req.doc_id, req.n)
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
