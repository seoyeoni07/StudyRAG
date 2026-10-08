from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, LargeBinary, String, Text

from .session import Base


class Document(Base):
    __tablename__ = "documents"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)
    filename = Column(String(256), nullable=False)
    chunks = Column(Integer, default=0)
    summary = Column(Text, nullable=True)
    folder = Column(String(64), nullable=True)
    group_id = Column(String(36), nullable=True, index=True)   # 그룹 공유 자료면 그룹 id
    # 이미지 자료는 글자 인식을 백그라운드로 돌린다: processing → done | failed
    status = Column(String(16), nullable=False, default="done", server_default="done")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DocumentFile(Base):
    """이미지 자료 원본. 인식 실패 시 다시 시도할 수 있도록 DB에 보관한다 (Render 디스크는 재배포 때 지워짐)."""
    __tablename__ = "document_files"
    doc_id = Column(String(36), primary_key=True)
    content_type = Column(String(64), nullable=False)
    data = Column(LargeBinary, nullable=False)


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


class TutorThread(Base):
    __tablename__ = "tutor_threads"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=True, index=True)
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=False)
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


class Note(Base):
    __tablename__ = "notes"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)
    doc_id = Column(String(36), nullable=True, index=True)
    title = Column(String(256), nullable=False, default="")
    icon = Column(String(16), nullable=True)
    content = Column(Text, nullable=False, default="")
    group_id = Column(String(36), nullable=True, index=True)   # 그룹 공동 노트면 그룹 id
    ydoc = Column(Text, nullable=True)                         # 공동 노트의 Yjs 상태 (base64)
    last_edited_by = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class StudyGroup(Base):
    __tablename__ = "study_groups"
    id = Column(String(36), primary_key=True)
    name = Column(String(64), nullable=False)
    invite_code = Column(String(8), unique=True, index=True, nullable=False)
    owner_id = Column(String(128), nullable=False)
    visibility = Column(String(16), nullable=False, default="code", server_default="code")  # public | code
    level = Column(String(32), nullable=True)
    sublevel = Column(String(64), nullable=True)
    subject = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class StudyGroupMember(Base):
    __tablename__ = "study_group_members"
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=False, index=True)
    display_name = Column(String(64), nullable=False)
    role = Column(String(16), default="member")  # owner / member
    joined_at = Column(DateTime, default=datetime.utcnow)


class NoteImage(Base):
    """노트에 넣은 이미지. Render 디스크는 재배포 때 지워지므로 DB에 저장한다."""
    __tablename__ = "note_images"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)
    content_type = Column(String(64), nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
