"""실사용 통계 엔드포인트 — 보고서·대시보드용."""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.models import ConceptAttempt, Document, Flashcard, QAThread, QuizHistory, WrongAnswer
from ..db.session import SessionLocal

router = APIRouter(prefix="/stats", tags=["stats"])

_OUT_OF_SCOPE = "강의자료에서 찾을 수 없는"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("")
def global_stats(db: Session = Depends(get_db)):
    """서비스 전체 집계. 인증 불필요 — 공개 지표."""
    total_docs = db.query(func.count(Document.id)).scalar() or 0
    docs_with_summary = db.query(func.count(Document.id)).filter(Document.summary.isnot(None)).scalar() or 0

    quiz_rows = db.query(QuizHistory.total, QuizHistory.correct).all()
    total_attempts = sum(r.total for r in quiz_rows)
    total_correct = sum(r.correct for r in quiz_rows)
    avg_accuracy = round(total_correct / total_attempts * 100, 1) if total_attempts else 0

    total_qa = db.query(func.count(QAThread.id)).scalar() or 0
    out_of_scope = (
        db.query(func.count(QAThread.id))
        .filter(QAThread.answer.contains(_OUT_OF_SCOPE))
        .scalar()
        or 0
    )
    in_scope = total_qa - out_of_scope
    in_scope_rate = round(in_scope / total_qa * 100, 1) if total_qa else 0

    total_cards = db.query(func.count(Flashcard.id)).scalar() or 0
    total_concept_attempts = db.query(func.count(ConceptAttempt.id)).scalar() or 0
    total_wrongs = db.query(func.count(WrongAnswer.id)).scalar() or 0

    return {
        "documents": {
            "total": total_docs,
            "with_summary": docs_with_summary,
        },
        "quiz": {
            "sessions": len(quiz_rows),
            "total_attempts": total_attempts,
            "avg_accuracy_pct": avg_accuracy,
            "wrong_answers_saved": total_wrongs,
        },
        "qa": {
            "total_questions": total_qa,
            "in_scope": in_scope,
            "out_of_scope": out_of_scope,
            "in_scope_rate_pct": in_scope_rate,
        },
        "flashcards": total_cards,
        "concept_attempts": total_concept_attempts,
    }
