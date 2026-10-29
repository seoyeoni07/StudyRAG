from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, LargeBinary, String, Text, UniqueConstraint

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
    group_id = Column(String(36), nullable=True, index=True)
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
    tags = Column(Text, nullable=True)                         # JSON array of tag strings
    ydoc = Column(Text, nullable=True)                         # 공동 노트의 Yjs 상태 (base64)
    last_edited_by = Column(String(128), nullable=True)
    versions_public = Column(Boolean, nullable=False, default=False, server_default="false")
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
    announcement = Column(Text, nullable=True)
    announcement_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class StudyGroupMember(Base):
    __tablename__ = "study_group_members"
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=False, index=True)
    display_name = Column(String(64), nullable=False)
    role = Column(String(16), default="member")  # owner / member
    joined_at = Column(DateTime, default=datetime.utcnow)


class NoteVersion(Base):
    __tablename__ = "note_versions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    note_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=True)
    title = Column(String(256), nullable=False, default="")
    content = Column(Text, nullable=True)   # 개인 노트
    ydoc = Column(Text, nullable=True)      # 그룹 노트 (Yjs 상태)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserProfile(Base):
    __tablename__ = "user_profiles"
    uid = Column(String(128), primary_key=True)
    email = Column(String(256), nullable=True, index=True)
    display_name = Column(String(64), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class GroupMessage(Base):
    __tablename__ = "group_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=False)
    display_name = Column(String(64), nullable=False)
    content = Column(Text, nullable=False)
    # 첨부파일 (사진·파일) — 실제 파일은 note_images 테이블(/notes/files)에 있다
    attachment_url = Column(String(128), nullable=True)
    attachment_name = Column(String(256), nullable=True)
    attachment_type = Column(String(128), nullable=True)
    attachment_size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class NoteShare(Base):
    __tablename__ = "note_shares"
    id = Column(Integer, primary_key=True, autoincrement=True)
    note_id = Column(String(36), nullable=False, index=True)
    owner_id = Column(String(128), nullable=False)
    shared_with = Column(String(128), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class NoteImage(Base):
    """노트에 넣은 이미지·첨부파일. Render 디스크는 재배포 때 지워지므로 DB에 저장한다."""
    __tablename__ = "note_images"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)
    content_type = Column(String(128), nullable=False)
    filename = Column(String(256), nullable=True)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatRead(Base):
    """대화방별로 각 사람이 어디까지 읽었는지 (읽음 표시·안 읽은 개수용).
    room_key: "dm:{방 id}" 또는 "group:{그룹 id}"."""
    __tablename__ = "chat_reads"
    __table_args__ = (UniqueConstraint("room_key", "user_id", name="uq_chat_reads_room_user"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    room_key = Column(String(48), nullable=False, index=True)
    user_id = Column(String(128), nullable=False)
    last_read_id = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class DmRoom(Base):
    """1:1 DM 방. user1_id < user2_id 로 항상 정렬해 중복 방지."""
    __tablename__ = "dm_rooms"
    id = Column(String(36), primary_key=True)
    user1_id = Column(String(128), nullable=False, index=True)
    user2_id = Column(String(128), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DmMessage(Base):
    __tablename__ = "dm_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(128), nullable=False)
    display_name = Column(String(64), nullable=False, default="나")
    content = Column(Text, nullable=False)
    # 첨부파일 (사진·파일) — 실제 파일은 note_images 테이블(/notes/files)에 있다
    attachment_url = Column(String(128), nullable=True)
    attachment_name = Column(String(256), nullable=True)
    attachment_type = Column(String(128), nullable=True)
    attachment_size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── 스터디 플래너 ─────────────────────────────────────────────────────────────

class Planner(Base):
    """플래너 한 권. 개인용(owner_type=user)은 사람마다, 스터디용(owner_type=group)은 그룹마다 하나."""
    __tablename__ = "planners"
    __table_args__ = (UniqueConstraint("owner_type", "owner_id", name="uq_planner_owner"),)
    id = Column(String(36), primary_key=True)
    owner_type = Column(String(8), nullable=False)        # user | group
    owner_id = Column(String(128), nullable=False, index=True)
    title = Column(String(64), nullable=False, default="스터디 플래너")
    theme = Column(String(16), nullable=False, default="basic")
    settings = Column(Text, nullable=True)                 # JSON: {subjects:[{name,color}], dday:{label,date}}
    created_at = Column(DateTime, default=datetime.utcnow)


class PlannerDay(Base):
    """하루 칸: 오늘의 목표, 메모, 스티커, 10분 시간표."""
    __tablename__ = "planner_days"
    __table_args__ = (UniqueConstraint("planner_id", "date", name="uq_planner_day"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    planner_id = Column(String(36), nullable=False, index=True)
    date = Column(String(10), nullable=False)              # YYYY-MM-DD
    goal = Column(String(200), nullable=True)
    memo = Column(Text, nullable=True)
    stickers = Column(Text, nullable=True)                 # JSON: ["🔥", ...]
    timeline = Column(Text, nullable=True)                 # JSON: {"슬롯번호": {"s": 과목, "k": "plan"|"done"}}
    updated_by = Column(String(128), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class PlannerTask(Base):
    """할 일 하나. 자료·노트와 연결할 수 있다."""
    __tablename__ = "planner_tasks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    planner_id = Column(String(36), nullable=False, index=True)
    date = Column(String(10), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    subject = Column(String(40), nullable=True)
    minutes = Column(Integer, nullable=True)
    done = Column(Boolean, default=False, nullable=False)
    sort = Column(Integer, default=0, nullable=False)
    link_type = Column(String(8), nullable=True)           # doc | note | gnote
    link_id = Column(String(36), nullable=True)
    link_label = Column(String(256), nullable=True)
    source = Column(String(8), nullable=True)              # ai | user
    created_by = Column(String(128), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)
