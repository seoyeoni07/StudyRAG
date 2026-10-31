"""시험 대비 모드: 한 장 요약 · 예상 문제 · 자주 틀린 것 · 기출 분석."""
import asyncio
import json
import os
import tempfile
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.learning import ask_json, ask_text, can_read_doc, concept_mastery, doc_concepts, summary_of
from ..db.models import Document, ExamPrep, WrongAnswer
from ..db.session import SessionLocal

router = APIRouter(prefix="/exam", tags=["exam"])

_MAX_PAST = 15 * 1024 * 1024


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(401, "로그인이 필요합니다.")
    return x_user_id


def _loads(s, default):
    try:
        return json.loads(s) if s else default
    except Exception:
        return default


def _out(p: ExamPrep, docs: dict[str, Document] | None = None) -> dict:
    ids = _loads(p.doc_ids, [])
    return {
        "id": p.id, "title": p.title, "exam_date": p.exam_date, "doc_ids": ids,
        "docs": [{"doc_id": i, "filename": docs[i].filename if docs and i in docs else None} for i in ids],
        "sheet": p.sheet, "predicted": _loads(p.predicted, None),
        "past_analysis": _loads(p.past_analysis, None), "past_filename": p.past_filename,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _prep(db: Session, prep_id: str, user_id: str) -> ExamPrep:
    p = db.query(ExamPrep).filter(ExamPrep.id == prep_id, ExamPrep.user_id == user_id).first()
    if not p:
        raise HTTPException(404, "시험 대비를 찾을 수 없습니다.")
    return p


def _docs(db: Session, p: ExamPrep, user_id: str) -> dict[str, Document]:
    ids = _loads(p.doc_ids, [])
    rows = db.query(Document).filter(Document.id.in_(ids)).all() if ids else []
    return {d.id: d for d in rows if can_read_doc(db, d, user_id)}


class PrepIn(BaseModel):
    title: str
    doc_ids: list[str]
    exam_date: str | None = None


@router.get("")
def list_preps(x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    rows = db.query(ExamPrep).filter(ExamPrep.user_id == user_id).order_by(ExamPrep.created_at.desc()).all()
    return [{"id": p.id, "title": p.title, "exam_date": p.exam_date, "doc_count": len(_loads(p.doc_ids, [])),
             "has_sheet": bool(p.sheet), "has_predicted": bool(p.predicted), "has_past": bool(p.past_analysis)}
            for p in rows]


@router.post("")
def create_prep(body: PrepIn, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    ids = []
    for i in body.doc_ids[:10]:
        d = db.query(Document).filter(Document.id == i).first()
        if can_read_doc(db, d, user_id) and i not in ids:
            ids.append(i)
    if not ids:
        raise HTTPException(400, "시험 범위 자료를 하나 이상 골라주세요.")
    if body.exam_date:
        try:
            datetime.strptime(body.exam_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "시험일 형식이 올바르지 않아요.")
    p = ExamPrep(id=str(uuid.uuid4()), user_id=user_id, title=(body.title.strip() or "시험 대비")[:128],
                 exam_date=body.exam_date or None, doc_ids=json.dumps(ids))
    db.add(p)
    db.commit()
    return _out(p, _docs(db, p, user_id))


@router.get("/{prep_id}")
def get_prep(prep_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    p = _prep(db, prep_id, user_id)
    return _out(p, _docs(db, p, user_id))


@router.patch("/{prep_id}")
def edit_prep(prep_id: str, body: PrepIn, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    p = _prep(db, prep_id, user_id)
    p.title = (body.title.strip() or p.title)[:128]
    p.exam_date = body.exam_date or None
    ids = [i for i in body.doc_ids[:10] if can_read_doc(db, db.query(Document).filter(Document.id == i).first(), user_id)]
    if ids:
        p.doc_ids = json.dumps(list(dict.fromkeys(ids)))
    p.updated_at = datetime.utcnow()
    db.commit()
    return _out(p, _docs(db, p, user_id))


@router.delete("/{prep_id}")
def delete_prep(prep_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    p = _prep(db, prep_id, _user(x_user_id))
    db.delete(p)
    db.commit()
    return {"ok": True}


# ── 재료 모으기 ────────────────────────────────────────

def _material(db: Session, p: ExamPrep, user_id: str) -> dict:
    docs = _docs(db, p, user_id)
    parts, concepts = [], []
    for d in docs.values():
        s = summary_of(d)
        concepts += doc_concepts(d)
        if s.get("overview"):
            parts.append(f"[{d.filename}]\n개요: {s['overview']}\n핵심: " + " / ".join(map(str, s.get("key_concepts") or [])))
        else:
            parts.append(f"[{d.filename}] (요약 없음)")
    weak = [f"{m['concept']}({int(m['score'] * 100)}%)" for m in concept_mastery(db, user_id, list(docs))
            if m["level"] in ("weak", "mid")][:10]
    wrongs = db.query(WrongAnswer).filter(WrongAnswer.doc_id.in_(list(docs)), WrongAnswer.reviewed == False)\
        .order_by(WrongAnswer.created_at.desc()).limit(12).all() if docs else []  # noqa: E712
    return {"docs": docs, "summaries": "\n\n".join(parts), "concepts": list(dict.fromkeys(concepts)),
            "weak": weak, "wrongs": [f"- {w.question[:120]} (정답: {w.correct_answer[:60]})" for w in wrongs]}


def _chunks(doc_ids: list[str], query: str, k: int = 4) -> str:
    from ..core.rag import get_vectorstore
    out = []
    for i in doc_ids:
        try:
            for h in get_vectorstore(i).as_retriever(search_type="mmr", search_kwargs={"k": k, "fetch_k": 20}).invoke(query):
                out.append(f"(p.{h.metadata.get('page')}) {h.page_content}")
        except Exception:
            pass
    return "\n\n---\n\n".join(out)[:9000]


_SHEET_PROMPT = """너는 시험 직전 학생을 돕는 조교야. 아래 자료로 'A4 한 장 요약'을 마크다운으로 써.

규칙:
- 시험에 나올 핵심만. 정의·공식·비교·자주 헷갈리는 점 위주로 짧게. 전체 900자~1600자.
- '## 꼭 외울 것', '## 헷갈리는 것', '## 이 학생의 약점' 같은 소제목을 써.
- 학생의 약한 개념과 틀린 문제는 '이 학생의 약점'에 따로 짚어줘.
- 수식은 $...$ 로.

자료 요약:
{summaries}

자료 본문 일부:
{chunks}

학생의 약한 개념: {weak}
최근 틀린 문제:
{wrongs}
{past}"""


@router.post("/{prep_id}/sheet")
async def make_sheet(prep_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    p = _prep(db, prep_id, user_id)
    m = _material(db, p, user_id)
    chunks = await asyncio.to_thread(_chunks, list(m["docs"]), "정의 공식 핵심 개념 비교", 3)
    past = ""
    pa = _loads(p.past_analysis, None)
    if pa:
        past = "기출 경향: " + json.dumps(pa.get("topics", [])[:8], ensure_ascii=False)
    prompt = _SHEET_PROMPT.format(summaries=m["summaries"][:5000], chunks=chunks, weak=", ".join(m["weak"]) or "없음",
                                  wrongs="\n".join(m["wrongs"]) or "없음", past=past)
    try:
        sheet = await asyncio.to_thread(ask_text, prompt)
    except ValueError as e:
        raise HTTPException(503, str(e))
    p.sheet = sheet.strip().removeprefix("```markdown").removeprefix("```").removesuffix("```").strip()[:12000]
    p.updated_at = datetime.utcnow()
    db.commit()
    return {"sheet": p.sheet}


_PREDICT_PROMPT = """너는 대학 시험 출제 위원이야. 아래 자료로 실제 시험에 나올 법한 예상 문제 {n}개를 내.

규칙:
- 객관식(4지선다)과 서술·단답형을 섞어. 기출 경향이 있으면 그 유형·주제 비중을 따라.
- 학생의 약한 개념이 있으면 그 문제를 꼭 넣어.
- 각 문제에 출제 이유(why)를 한 줄로: 예) "기출 3회 출제", "자료에서 강조", "약점 개념".
- page: 근거가 되는 자료 페이지 번호(본문의 (p.N) 표시). 모르면 null.

자료 본문:
{chunks}

자료 요약:
{summaries}

학생의 약한 개념: {weak}
{past}

반드시 이 JSON으로만 답해:
{{"questions": [{{"type": "multiple_choice", "question": "문제", "options": ["A. …", "B. …", "C. …", "D. …"],
"answer": "A", "explanation": "해설", "concept": "개념", "why": "출제 이유", "page": 3}},
{{"type": "short_answer", "question": "문제", "answer": "모범 답안", "explanation": "채점 포인트", "concept": "개념", "why": "출제 이유", "page": null}}]}}"""


class PredictIn(BaseModel):
    n: int = 8


@router.post("/{prep_id}/predict")
async def predict(prep_id: str, body: PredictIn = PredictIn(), x_user_id: str | None = Header(default=None),
                  db: Session = Depends(get_db)):
    user_id = _user(x_user_id)
    p = _prep(db, prep_id, user_id)
    m = _material(db, p, user_id)
    n = max(3, min(15, body.n))
    query = " ".join(m["weak"][:3]) or "시험에 나올 핵심 개념"
    chunks = await asyncio.to_thread(_chunks, list(m["docs"]), query, 4)
    past = ""
    if p.past_analysis or p.past_text:
        past = "기출 분석: " + (p.past_analysis or "")[:1500] + "\n기출 원문 일부:\n" + (p.past_text or "")[:2500]
    prompt = _PREDICT_PROMPT.format(n=n, chunks=chunks, summaries=m["summaries"][:3000],
                                    weak=", ".join(m["weak"]) or "없음", past=past)
    try:
        data = await asyncio.to_thread(ask_json, prompt, lambda d: isinstance(d, dict) and d.get("questions"))
    except ValueError as e:
        raise HTTPException(503, str(e))
    qs = []
    for q in data["questions"]:
        if not isinstance(q, dict) or not q.get("question"):
            continue
        mc = q.get("type") == "multiple_choice" and isinstance(q.get("options"), list)
        page = q.get("page")
        qs.append({
            "type": "multiple_choice" if mc else "short_answer", "question": str(q["question"]),
            "options": [str(o) for o in q["options"]][:6] if mc else None,
            "answer": str(q.get("answer", "")), "explanation": str(q.get("explanation", "")),
            "concept": str(q.get("concept") or "")[:60] or None, "why": str(q.get("why") or "")[:80] or None,
            "page": page if isinstance(page, int) else None,
        })
    if not qs:
        raise HTTPException(503, "예상 문제를 만들지 못했어요. 잠시 후 다시 시도해주세요.")
    first_doc = next(iter(m["docs"]), None)
    p.predicted = json.dumps({"questions": qs, "doc_id": first_doc, "made_at": datetime.utcnow().isoformat()}, ensure_ascii=False)
    p.updated_at = datetime.utcnow()
    db.commit()
    return _loads(p.predicted, {})


@router.get("/{prep_id}/mistakes")
def mistakes(prep_id: str, x_user_id: str | None = Header(default=None), db: Session = Depends(get_db)):
    """자주 틀린 것 모음 — AI 없이 오답·약점 지도로 바로 만든다."""
    user_id = _user(x_user_id)
    p = _prep(db, prep_id, user_id)
    docs = _docs(db, p, user_id)
    wrongs = db.query(WrongAnswer).filter(WrongAnswer.doc_id.in_(list(docs))).order_by(WrongAnswer.created_at.desc()).all() if docs else []
    by: dict[str, dict] = {}
    for w in wrongs:
        key = w.concept or "개념 미분류"
        g = by.setdefault(key, {"concept": key, "count": 0, "open": 0, "items": []})
        g["count"] += 1
        g["open"] += 0 if w.reviewed else 1
        if len(g["items"]) < 5 and not any(i["question"] == w.question for i in g["items"]):
            g["items"].append({"id": w.id, "doc_id": w.doc_id, "question": w.question, "correct_answer": w.correct_answer,
                               "user_answer": w.user_answer, "explanation": w.explanation, "reviewed": bool(w.reviewed),
                               "filename": docs[w.doc_id].filename if w.doc_id in docs else None})
    groups = sorted(by.values(), key=lambda g: (g["concept"] == "개념 미분류", -g["open"], -g["count"]))
    weak = [m for m in concept_mastery(db, user_id, list(docs)) if m["level"] in ("weak", "mid")][:12]
    for m in weak:
        m["filename"] = docs[m["doc_id"]].filename if m["doc_id"] in docs else None
    return {"groups": groups, "weak": weak, "total": len(wrongs)}


_PAST_PROMPT = """너는 기출문제 분석가야. 아래는 학생이 올린 기출문제(시험지) 원문이야.
시험 범위 자료의 개념 목록: {concepts}

할 일: 출제 경향을 분석해.
- topics: 주제별 출제 횟수(문항 수)와 그 주제가 개념 목록 중 무엇과 맞는지(match, 없으면 null). 많이 나온 순서.
- types: 문제 유형별 문항 수 (예: 객관식, 단답형, 서술형, 계산).
- difficulty: 전체 난이도 한 줄.
- tips: 이 시험을 준비하는 팁 3개.
- summary: 경향 요약 2~3문장.

기출 원문:
{text}

반드시 이 JSON으로만 답해:
{{"topics": [{{"name": "주제", "count": 3, "match": "개념명 또는 null"}}], "types": {{"객관식": 10}},
"difficulty": "…", "tips": ["…"], "summary": "…"}}"""


@router.post("/{prep_id}/past")
async def analyze_past(prep_id: str, file: UploadFile = File(...), x_user_id: str | None = Header(default=None),
                       db: Session = Depends(get_db)):
    """기출 PDF·사진을 올리면 글자를 뽑아 출제 경향을 분석한다. 기출은 자료로 저장하지 않는다."""
    user_id = _user(x_user_id)
    p = _prep(db, prep_id, user_id)
    data = await file.read(_MAX_PAST + 1)
    if len(data) > _MAX_PAST:
        raise HTTPException(413, "기출 파일은 15MB 이하만 올릴 수 있어요.")
    name = file.filename or "기출"
    ct = file.content_type or ""
    from ..core.parser import extract_chunks_with_pages, extract_text_from_image

    def extract() -> str:
        if ct == "application/pdf" or name.lower().endswith(".pdf"):
            fd, path = tempfile.mkstemp(suffix=".pdf")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                return "\n".join(c for c, _ in extract_chunks_with_pages(path))
            finally:
                os.remove(path)
        if ct.startswith("image/"):
            return extract_text_from_image(data, ct)
        raise ValueError("PDF나 사진(JPG·PNG)만 올릴 수 있어요.")

    try:
        text = await asyncio.to_thread(extract)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if len(text.strip()) < 30:
        raise HTTPException(422, "기출에서 글자를 거의 찾지 못했어요. 더 선명한 파일로 다시 올려주세요.")
    m = _material(db, p, user_id)
    prompt = _PAST_PROMPT.format(concepts=", ".join(m["concepts"][:30]) or "없음", text=text[:9000])
    try:
        analysis = await asyncio.to_thread(ask_json, prompt, lambda d: isinstance(d, dict) and d.get("topics") is not None)
    except ValueError as e:
        raise HTTPException(503, str(e))
    topics = []
    for t in analysis.get("topics") or []:
        if isinstance(t, dict) and t.get("name"):
            try:
                cnt = int(t.get("count") or 1)
            except (TypeError, ValueError):
                cnt = 1
            match = t.get("match")
            topics.append({"name": str(t["name"])[:60], "count": max(1, cnt),
                           "match": str(match)[:60] if match and str(match).lower() != "null" else None})
    types = {str(k)[:20]: v for k, v in (analysis.get("types") or {}).items() if isinstance(v, (int, float))}
    result = {"topics": topics[:20], "types": types, "difficulty": str(analysis.get("difficulty") or "")[:200],
              "tips": [str(t)[:200] for t in (analysis.get("tips") or [])][:5], "summary": str(analysis.get("summary") or "")[:600]}
    p.past_text = text[:20000]
    p.past_analysis = json.dumps(result, ensure_ascii=False)
    p.past_filename = name[:256]
    p.updated_at = datetime.utcnow()
    db.commit()
    return {"past_analysis": result, "past_filename": p.past_filename}
