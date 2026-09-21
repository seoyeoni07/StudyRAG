from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from .session import Base


class QuizSession(Base):
    __tablename__ = "quiz_sessions"
    id = Column(String(36), primary_key=True)
    doc_id = Column(String(36), nullable=False, index=True)
    questions_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class WrongAnswer(Base):
    __tablename__ = "wrong_answers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(36), nullable=False, index=True)
    session_id = Column(String(36), nullable=False)
    question = Column(Text, nullable=False)
    correct_answer = Column(Text, nullable=False)
    user_answer = Column(Text, nullable=False)
    explanation = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class QuizHistory(Base):
    __tablename__ = "quiz_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(36), nullable=False, index=True)
    session_id = Column(String(36), nullable=False)
    total = Column(Integer, nullable=False)
    correct = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
