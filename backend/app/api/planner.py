"""스터디 플래너 — 개인용(사람마다 하나)과 스터디용(그룹마다 하나)."""
import asyncio
import json
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.models import (Document, Note, NoteShare, Planner, PlannerDay, PlannerTask,
                         StudyGroupMember, WrongAnswer)
from ..db.session import SessionLocal

router = APIRouter(prefix="/planner", tags=["planner"])

THEMES = {"basic", "pastel", "dark", "grid", "kraft"}
DEFAULT_COLORS = ["#4f8cff", "#2fb67c", "#f2994a", "#bb6bd9", "#eb5757", "#00a3bf", "#e2b93b", "#6c7a89"]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    return x_user_id


def _is_member(db: Session, group_id: str, user_id: str) -> bool:
    return db.query(StudyGroupMember).filter(
        StudyGroupMember.group_id == group_id, StudyGroupMember.user_id == user_id).first() is not None


def _get_planner(db: Session, planner_id: str, user_id: str) -> Planner:
    p = db.query(Planner).filter(Planner.id == planner_id).first()
    if p and ((p.owner_type == "user" and p.owner_id == user_id)
              or (p.owner_type == "group" and _is_member(db, p.owner_id, user_id))):
        return p
    raise HTTPException(404, "플래너를 찾을 수 없습니다.")


def _settings(p: Planner) -> dict:
    try:
        s = json.loads(p.settings or "{}")
    except Exception:
        s = {}
    s.setdefault("subjects", [])
    s.setdefault("dday", None)
    return s


def _planner_out(p: Planner) -> dict:
    return {"id": p.id, "owner_type": p.owner_type, "owner_id": p.owner_id,
            "title": p.title, "theme": p.theme, **_settings(p)}


def _get_or_create(db: Session, owner_type: str, owner_id: str, title: str) -> Planner:
    p = db.query(Planner).filter(Planner.owner_type == owner_type, Planner.owner_id == owner_id).first()
    if p:
        return p
    p = Planner(id=str(uuid.uuid4()), owner_type=owner_type, owner_id=owner_id, title=title, theme="basic",
                settings=json.dumps({"subjects": [], "dday": None}, ensure_ascii=False))
    db.add(p)
    try:
        db.commit()
    except Exception:          # 같은 사람이 탭 두 개에서 동시에 처음 열면 한쪽이 겹칠 수 있다
        db.rollback()
        p = db.query(Planner).filter(Planner.owner_type == owner_type, Planner.owner_id == owner_id).first()
    return p


def _day_out(d: PlannerDay) -> dict:
    def load(v, default):
        try:
            return json.loads(v) if v else default
        except Exception:
            return default
    return {"date": d.date, "goal": d.goal or "", "memo": d.memo or "",
            "stickers": load(d.stickers, []), "timeline": load(d.timeline, {}),
            "updated_by": d.updated_by}


def _task_out(t: PlannerTask) -> dict:
    return {"id": t.id, "date": t.date, "title": t.title, "subject": t.subject, "minutes": t.minutes,
            "done": bool(t.done), "sort": t.sort, "link_type": t.link_type, "link_id": t.link_id,
            "link_label": t.link_label, "source": t.source}


def _check_date(s: str) -> str:
    try:
        return date.fromisoformat(s).isoformat()
    except Exception:
        raise HTTPException(400, "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).")


# ── 플래너 ────────────────────────────────────────────────────────────────────

@router.get("/mine")
def my_planner(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    return _planner_out(_get_or_create(db, "user", user_id, "나의 공부 플래너"))


@router.get("/today-summary")
def today_summary(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    from datetime import date as _date
    user_id = _require_user(x_user_id)
    p = _get_or_create(db, "user", user_id, "나의 공부 플래너")
    today = str(_date.today())
    tasks = (db.query(PlannerTask)
             .filter(PlannerTask.planner_id == p.id, PlannerTask.date == today)
             .order_by(PlannerTask.sort, PlannerTask.id).all())
    day = db.query(PlannerDay).filter(PlannerDay.planner_id == p.id, PlannerDay.date == today).first()
    subjects = (_settings(p).get("subjects") or [])
    color_map = {s["name"]: s["color"] for s in subjects}
    return {
        "tasks": [_task_out(t) for t in tasks],
        "goal": day.goal if day else None,
        "color_map": color_map,
    }


@router.get("/group/{group_id}")
def group_planner(group_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    if not _is_member(db, group_id, user_id):
        raise HTTPException(403, "이 그룹의 멤버가 아닙니다.")
    return _planner_out(_get_or_create(db, "group", group_id, "스터디 플래너"))


class PlannerUpdate(BaseModel):
    title: str | None = None
    theme: str | None = None
    subjects: list[dict] | None = None     # [{name, color}]
    dday: dict | None = None               # {label, date} — 비우려면 {}


@router.patch("/{planner_id}")
def update_planner(planner_id: str, body: PlannerUpdate, x_user_id: str | None = Header(default=None),
                   db: Session = Depends(get_db)):
    p = _get_planner(db, planner_id, _require_user(x_user_id))
    s = _settings(p)
    if body.title is not None:
        p.title = body.title.strip()[:64] or p.title
    if body.theme is not None:
        if body.theme not in THEMES:
            raise HTTPException(400, "알 수 없는 테마입니다.")
        p.theme = body.theme
    if body.subjects is not None:
        seen, subjects = set(), []
        for i, sub in enumerate(body.subjects[:20]):
            name = str(sub.get("name", "")).strip()[:40]
            if name and name not in seen:
                seen.add(name)
                color = str(sub.get("color") or DEFAULT_COLORS[i % len(DEFAULT_COLORS)])[:9]
                subjects.append({"name": name, "color": color})
        s["subjects"] = subjects
    if body.dday is not None:
        if body.dday.get("date"):
            s["dday"] = {"label": str(body.dday.get("label") or "D-day")[:30], "date": _check_date(body.dday["date"])}
        else:
            s["dday"] = None
    p.settings = json.dumps(s, ensure_ascii=False)
    db.commit()
    return _planner_out(p)


# ── 날짜별 내용 ───────────────────────────────────────────────────────────────

@router.get("/{planner_id}/range")
def get_range(planner_id: str, start: str, end: str, x_user_id: str | None = Header(default=None),
              db: Session = Depends(get_db)):
    p = _get_planner(db, planner_id, _require_user(x_user_id))
    start, end = _check_date(start), _check_date(end)
    days = db.query(PlannerDay).filter(PlannerDay.planner_id == p.id,
                                       PlannerDay.date >= start, PlannerDay.date <= end).all()
    tasks = (db.query(PlannerTask)
             .filter(PlannerTask.planner_id == p.id, PlannerTask.date >= start, PlannerTask.date <= end)
             .order_by(PlannerTask.date, PlannerTask.sort, PlannerTask.id).all())
    return {"days": [_day_out(d) for d in days], "tasks": [_task_out(t) for t in tasks]}


class DayUpdate(BaseModel):
    goal: str | None = None
    memo: str | None = None
    stickers: list[str] | None = None
    timeline: dict | None = None   # 전체 교체: {"슬롯": {"s": 과목, "k": "plan"|"done"}}


def _get_day(db: Session, planner_id: str, d: str) -> PlannerDay:
    day = db.query(PlannerDay).filter(PlannerDay.planner_id == planner_id, PlannerDay.date == d).first()
    if not day:
        day = PlannerDay(planner_id=planner_id, date=d)
        db.add(day)
    return day


def _clean_timeline(tl: dict) -> dict:
    out = {}
    for k, v in (tl or {}).items():
        try:
            slot = int(k)
        except (TypeError, ValueError):
            continue
        if 0 <= slot < 20 * 6 and isinstance(v, dict) and v.get("s"):
            out[str(slot)] = {"s": str(v["s"])[:40], "k": "done" if v.get("k") == "done" else "plan"}
    return out


@router.put("/{planner_id}/days/{day}")
def update_day(planner_id: str, day: str, body: DayUpdate, x_user_id: str | None = Header(default=None),
               db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    p = _get_planner(db, planner_id, user_id)
    d = _get_day(db, p.id, _check_date(day))
    if body.goal is not None:
        d.goal = body.goal[:200]
    if body.memo is not None:
        d.memo = body.memo[:4000]
    if body.stickers is not None:
        d.stickers = json.dumps([str(x)[:8] for x in body.stickers[:30]], ensure_ascii=False)
    if body.timeline is not None:
        d.timeline = json.dumps(_clean_timeline(body.timeline), ensure_ascii=False)
    d.updated_by = user_id
    d.updated_at = datetime.utcnow()
    db.commit()
    return _day_out(d)


# ── 할 일 ─────────────────────────────────────────────────────────────────────

class TaskIn(BaseModel):
    date: str | None = None
    title: str | None = None
    subject: str | None = None
    minutes: int | None = None
    done: bool | None = None
    sort: int | None = None
    link_type: str | None = None
    link_id: str | None = None
    link_label: str | None = None


def _apply_task(t: PlannerTask, body: TaskIn):
    fields = body.model_dump(exclude_unset=True)
    if "date" in fields:
        t.date = _check_date(fields["date"])
    if "title" in fields:
        t.title = (fields["title"] or "").strip()[:200] or "할 일"
    if "subject" in fields:
        t.subject = (fields["subject"] or "")[:40] or None
    if "minutes" in fields:
        t.minutes = max(0, min(1440, int(fields["minutes"]))) if fields["minutes"] is not None else None
    if "done" in fields:
        t.done = bool(fields["done"])
    if "sort" in fields:
        t.sort = int(fields["sort"] or 0)
    if "link_type" in fields:
        lt = fields["link_type"]
        if lt not in (None, "doc", "note", "gnote"):
            raise HTTPException(400, "알 수 없는 연결 종류입니다.")
        t.link_type = lt
        t.link_id = (fields.get("link_id") or None) if lt else None
        t.link_label = (fields.get("link_label") or "")[:256] if lt else None
    t.updated_at = datetime.utcnow()


@router.post("/{planner_id}/tasks")
def add_task(planner_id: str, body: TaskIn, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    p = _get_planner(db, planner_id, user_id)
    if not body.date or not (body.title or "").strip():
        raise HTTPException(400, "날짜와 할 일을 입력하세요.")
    t = PlannerTask(planner_id=p.id, date=_check_date(body.date), title="할 일", created_by=user_id, source="user")
    _apply_task(t, body)
    db.add(t)
    db.flush()
    out = _task_out(t)
    db.commit()
    return out


def _get_task(db: Session, planner_id: str, task_id: int) -> PlannerTask:
    t = db.query(PlannerTask).filter(PlannerTask.id == task_id, PlannerTask.planner_id == planner_id).first()
    if not t:
        raise HTTPException(404, "할 일을 찾을 수 없습니다.")
    return t


@router.patch("/{planner_id}/tasks/{task_id}")
def update_task(planner_id: str, task_id: int, body: TaskIn, x_user_id: str | None = Header(default=None),
                db: Session = Depends(get_db)):
    p = _get_planner(db, planner_id, _require_user(x_user_id))
    t = _get_task(db, p.id, task_id)
    _apply_task(t, body)
    out = _task_out(t)
    db.commit()
    return out


@router.delete("/{planner_id}/tasks/{task_id}")
def delete_task(planner_id: str, task_id: int, x_user_id: str | None = Header(default=None),
                db: Session = Depends(get_db)):
    p = _get_planner(db, planner_id, _require_user(x_user_id))
    db.delete(_get_task(db, p.id, task_id))
    db.commit()
    return {"ok": True}


# ── 연결할 수 있는 자료·노트 ─────────────────────────────────────────────────

@router.get("/{planner_id}/linkables")
def linkables(planner_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """할 일에 연결할 수 있는 것: 개인 플래너는 내 자료·노트(+공유받은 노트), 스터디 플래너는 그룹 자료·노트."""
    user_id = _require_user(x_user_id)
    p = _get_planner(db, planner_id, user_id)
    if p.owner_type == "group":
        docs = db.query(Document).filter(Document.group_id == p.owner_id).order_by(Document.created_at.desc()).all()
        notes = db.query(Note).filter(Note.group_id == p.owner_id).order_by(Note.updated_at.desc()).all()
        return {"docs": [{"id": d.id, "label": d.filename} for d in docs],
                "notes": [{"id": n.id, "label": n.title or "제목 없음", "icon": n.icon, "type": "gnote"} for n in notes]}
    docs = (db.query(Document).filter(Document.user_id == user_id, Document.group_id.is_(None))
            .order_by(Document.created_at.desc()).all())
    mine = db.query(Note).filter(Note.user_id == user_id, Note.group_id.is_(None)).order_by(Note.updated_at.desc()).all()
    shared_ids = [s.note_id for s in db.query(NoteShare).filter(NoteShare.shared_with == user_id).all()]
    shared = db.query(Note).filter(Note.id.in_(shared_ids or ["-"])).all()
    return {"docs": [{"id": d.id, "label": d.filename} for d in docs],
            "notes": [{"id": n.id, "label": n.title or "제목 없음", "icon": n.icon, "type": "note"} for n in mine + shared]}


# ── AI 계획 ───────────────────────────────────────────────────────────────────

class AiSubject(BaseModel):
    name: str
    priority: int = 2
    exam_date: str | None = None
    doc_ids: list[str] = []
    note_ids: list[str] = []


class AiPlanBody(BaseModel):
    start: str
    end: str
    subjects: list[AiSubject]
    daily_minutes: int = 180
    weekend_minutes: int | None = None
    off_days: list[int] = []          # 0=월 ... 6=일
    start_time: str = "09:00"
    request: str = ""
    use_ai: bool = True


@router.post("/{planner_id}/ai-plan")
async def ai_plan(planner_id: str, body: AiPlanBody, x_user_id: str | None = Header(default=None),
                  db: Session = Depends(get_db)):
    """미리보기용 계획을 만든다 (저장하지 않음). 적용은 /apply."""
    from ..core.planner_ai import build_plan
    user_id = _require_user(x_user_id)
    p = _get_planner(db, planner_id, user_id)
    colors = {s["name"]: s["color"] for s in _settings(p)["subjects"]}

    subjects = []
    for s in body.subjects[:10]:
        name = s.name.strip()[:40]
        if not name:
            continue
        concepts, wrongs, links = [], 0, []
        for doc_id in s.doc_ids[:5]:
            d = db.query(Document).filter(Document.id == doc_id).first()
            if not d:
                continue
            ok = d.user_id == user_id if not d.group_id else _is_member(db, d.group_id, user_id)
            if not ok:
                continue
            links.append({"type": "doc", "id": d.id, "label": d.filename})
            try:
                concepts += (json.loads(d.summary or "{}").get("key_concepts") or [])[:8]
            except Exception:
                pass
            wrongs += db.query(WrongAnswer).filter(WrongAnswer.doc_id == d.id, WrongAnswer.reviewed == False).count()  # noqa: E712
        for note_id in s.note_ids[:5]:
            n = db.query(Note).filter(Note.id == note_id).first()
            if n:
                links.append({"type": "gnote" if n.group_id else "note", "id": n.id, "label": n.title or "제목 없음"})
        subjects.append({"name": name, "color": colors.get(name), "priority": s.priority,
                         "exam_date": _check_date(s.exam_date) if s.exam_date else None,
                         "concepts": concepts, "wrongs": wrongs, "links": links})
    try:
        plan = await asyncio.to_thread(
            build_plan, start=date.fromisoformat(_check_date(body.start)), end=date.fromisoformat(_check_date(body.end)),
            subjects=subjects, daily_minutes=max(10, min(960, body.daily_minutes)),
            weekend_minutes=None if body.weekend_minutes is None else max(0, min(960, body.weekend_minutes)),
            off_days=[d for d in body.off_days if 0 <= d <= 6], start_time=body.start_time,
            request=body.request, use_ai=body.use_ai,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return plan


class ApplyBody(BaseModel):
    days: list[dict]          # ai-plan 결과의 days (사용자가 미리보기에서 고친 것 포함)
    replace: bool = False     # True면 그 날짜들의 AI가 만든 할 일·계획 칸을 지우고 새로


@router.post("/{planner_id}/apply")
def apply_plan(planner_id: str, body: ApplyBody, x_user_id: str | None = Header(default=None),
               db: Session = Depends(get_db)):
    user_id = _require_user(x_user_id)
    p = _get_planner(db, planner_id, user_id)
    added = 0
    for day in body.days[:100]:
        dstr = _check_date(str(day.get("date", "")))
        if body.replace:
            db.query(PlannerTask).filter(PlannerTask.planner_id == p.id, PlannerTask.date == dstr,
                                         PlannerTask.source == "ai").delete(synchronize_session=False)
        base = db.query(PlannerTask).filter(PlannerTask.planner_id == p.id, PlannerTask.date == dstr).count()
        for i, t in enumerate((day.get("tasks") or [])[:12]):
            task = PlannerTask(planner_id=p.id, date=dstr, title="할 일", created_by=user_id, source="ai", sort=base + i)
            _apply_task(task, TaskIn(**{k: t.get(k) for k in ("title", "subject", "minutes", "link_type", "link_id", "link_label") if k in t}))
            db.add(task)
            added += 1
        blocks = _clean_timeline(day.get("blocks") or {})
        if blocks:
            d = _get_day(db, p.id, dstr)
            try:
                cur = json.loads(d.timeline or "{}")
            except Exception:
                cur = {}
            if body.replace:   # AI 계획 칸만 지우고, 내가 직접 칠한 '실제' 칸은 남긴다
                cur = {k: v for k, v in cur.items() if v.get("k") == "done"}
            for k, v in blocks.items():
                cur.setdefault(k, v)   # 이미 칠해 둔 칸은 덮어쓰지 않는다
            d.timeline = json.dumps(cur, ensure_ascii=False)
            d.updated_by = user_id
            d.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "added": added}
