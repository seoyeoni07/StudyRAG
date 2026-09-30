from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from .session import Base


class Document(Base):
    __tablename__ = "documents"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)
    filename = Column(String(256), nullable=False)
    chunks = Column(Integer, default=0)
    summary = Column(Text, nullable=True)
    folder = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


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
    reviewed = Column(Boolean, default=False, server_default="false")
    next_review = Column(DateTime, nullable=True)   # 스페이스드 리피티션
    review_count = Column(Integer, default=0, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)


class QuizHistory(Base):
    __tablename__ = "quiz_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(36), nullable=False, index=True)
    session_id = Column(String(36), nullable=False)
    total = Column(Integer, nullable=False)
    correct = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class QAThread(Base):
    __tablename__ = "qa_threads"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    sources_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class QAFeedback(Base):
    __tablename__ = "qa_feedback"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(36), nullable=False, index=True)
    question = Column(Text, nullable=False)
    helpful = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class QuizReport(Base):
    __tablename__ = "quiz_reports"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), nullable=False)
    question = Column(Text, nullable=False)
    issue = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class StudyRoom(Base):
    __tablename__ = "study_rooms"
    id = Column(String(36), primary_key=True)
    code = Column(String(8), unique=True, index=True, nullable=False)
    doc_id = Column(String(36), nullable=False)
    host_user_id = Column(String(128), nullable=False)
    session_id = Column(String(36), nullable=True)
    status = Column(String(16), default="waiting")  # waiting / active / finished
    created_at = Column(DateTime, default=datetime.utcnow)


class StudyRoomMember(Base):
    __tablename__ = "study_room_members"
    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=False)
    nickname = Column(String(64), nullable=False)
    score = Column(Integer, nullable=True)
    total = Column(Integer, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
