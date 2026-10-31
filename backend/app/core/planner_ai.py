"""AI 공부 계획.

1) AI가 과목별 '공부 단위' 목록을 순서대로 만든다 (예: "3장 스택·큐 요약 정리 60분").
2) 코드가 그 단위들을 기간·공부 가능 시간·쉬는 요일·시험일에 맞춰 날짜에 배치한다.

AI(무료 모델)가 실패해도 2)는 항상 동작하도록, 자료의 핵심 개념·오답 수로 기본 단위를 만든다.
"""
import json
import logging
import math
import re
from datetime import date, timedelta

log = logging.getLogger(__name__)

SLOT_MIN = 10            # 시간표 한 칸 = 10분
DAY_START_HOUR = 6       # 시간표는 06:00부터
SLOTS_PER_DAY = 20 * 6   # 06:00 ~ 다음날 02:00

_UNITS_PROMPT = """너는 대학생 공부 계획 코치야. 아래 과목들을 공부할 '공부 단위' 목록을 과목별로 순서대로 만들어.

기간: {start} ~ {end} (공부하는 날 {days}일)
과목별로 쓸 수 있는 총 시간(분): {budgets}
{subjects}
학생 요청: {request}

규칙:
- 단위 하나는 30~90분. 과목별 단위 시간 합이 그 과목 총 시간과 비슷하게.
- 처음 배우기 → 정리 → 문제 풀기 → 복습 순서. 시험일이 있는 과목은 마지막에 '총정리' 단위.
- 제목은 구체적으로 (자료의 핵심 개념 이름을 써서). 20자 안팎.
- 오답이 있는 과목은 '오답 복습' 단위를 넣어.
- '약한 개념'이 있으면 그 개념 복습 단위를 앞쪽에 먼저 넣어 (예: "스택 약점 복습 30분").

반드시 이 JSON 형식으로만 답해:
{{"subjects": [{{"name": "과목명", "units": [{{"title": "단위 제목", "minutes": 60}}]}}]}}"""


def _parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0) if m else text)


def _daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _fallback_units(subj: dict, budget: int) -> list[dict]:
    """AI 없이 만드는 기본 단위: 핵심 개념 → 문제 풀이 → 오답 복습 → 총정리."""
    units = []
    for c in (subj.get("weak") or [])[:6]:
        units.append({"title": f"{c} 약점 복습", "minutes": 30})
    for c in (subj.get("concepts") or [])[:12]:
        units.append({"title": f"{c} 정리", "minutes": 50})
    if subj.get("wrongs"):
        units.append({"title": f"오답 복습 ({subj['wrongs']}문제)", "minutes": 40})
    units.append({"title": "문제 풀기·퀴즈", "minutes": 40})
    if subj.get("exam_date"):
        units.append({"title": "시험 대비 총정리", "minutes": 60})
    return units


def _ai_units(subjects: list[dict], budgets: dict, start: date, end: date, days: int, request: str) -> dict:
    from .rag import _llm, _PRIMARY_MODEL, _FALLBACK_MODELS
    desc = []
    for s in subjects:
        line = f"- {s['name']} (중요도 {s.get('priority', 2)}/3"
        if s.get("exam_date"):
            line += f", 시험일 {s['exam_date']}"
        if s.get("wrongs"):
            line += f", 안 푼 오답 {s['wrongs']}개"
        line += ")"
        if s.get("concepts"):
            line += " 핵심 개념: " + ", ".join(s["concepts"][:10])
        if s.get("weak"):
            line += " / 약한 개념(먼저 복습): " + ", ".join(s["weak"][:6])
        desc.append(line)
    prompt = _UNITS_PROMPT.format(
        start=start.isoformat(), end=end.isoformat(), days=days,
        budgets=json.dumps(budgets, ensure_ascii=False),
        subjects="\n".join(desc), request=(request or "없음")[:300],
    )
    for model in [_PRIMARY_MODEL] + _FALLBACK_MODELS:
        try:
            data = _parse_json(_llm(model).invoke(prompt).content)
            out = {}
            for s in data.get("subjects", []):
                units = [
                    {"title": str(u.get("title", "")).strip()[:80] or "공부",
                     "minutes": max(10, min(180, int(u.get("minutes") or 50)))}
                    for u in s.get("units", []) if isinstance(u, dict)
                ]
                if units:
                    out[str(s.get("name", "")).strip()] = units
            if out:
                return out
        except Exception as e:  # 무료 모델은 자주 막힌다 — 다음 모델, 그래도 안 되면 기본 단위
            log.warning("planner AI %s failed: %s", model, e)
    return {}


def build_plan(*, start: date, end: date, subjects: list[dict], daily_minutes: int,
               weekend_minutes: int | None, off_days: list[int], start_time: str,
               request: str = "", use_ai: bool = True) -> dict:
    """
    subjects: [{name, color, priority(1~3), exam_date?, links:[{type,id,label}], concepts:[...], wrongs:int}]
    반환: {"days": [{date, tasks:[{subject,title,minutes,link_type,link_id,link_label}], blocks:{slot:{s,k}}}],
           "ai": bool, "summary": {과목: 분}}
    """
    if end < start:
        raise ValueError("끝나는 날이 시작하는 날보다 빨라요.")
    if (end - start).days > 92:
        raise ValueError("계획 기간은 최대 3개월까지 만들 수 있어요.")
    if not subjects:
        raise ValueError("과목을 하나 이상 골라주세요.")

    def budget_of(d: date) -> int:
        if d.weekday() in off_days:
            return 0
        if d.weekday() >= 5 and weekend_minutes is not None:
            return weekend_minutes
        return daily_minutes

    study_days = [d for d in _daterange(start, end) if budget_of(d) > 0]
    if not study_days:
        raise ValueError("공부하는 날이 없어요. 쉬는 요일이나 공부 시간을 확인해주세요.")

    # 과목별 마지막 공부일(시험 전날)과 가중치
    for s in subjects:
        ex = s.get("exam_date")
        s["_last"] = min(end, date.fromisoformat(ex) - timedelta(days=1)) if ex else end
        s["_w"] = max(1, min(3, int(s.get("priority") or 2))) * (1.5 if ex else 1.0)

    # 과목별 총 시간: 그 과목이 공부 가능한 날의 예산을 가중치대로 나눈다
    totals = {s["name"]: 0.0 for s in subjects}
    for d in study_days:
        active = [s for s in subjects if d <= s["_last"]]
        wsum = sum(s["_w"] for s in active)
        for s in active:
            totals[s["name"]] += budget_of(d) * s["_w"] / wsum
    budgets = {k: int(round(v / SLOT_MIN) * SLOT_MIN) for k, v in totals.items()}

    ai_units = _ai_units(subjects, budgets, start, end, len(study_days), request) if use_ai else {}

    # 과목별 단위 큐 — AI 결과가 모자라면 기본 단위·복습으로 채우고, 넘치면 자른다
    queues, final_q = {}, {}
    for s in subjects:
        units = ai_units.get(s["name"]) or _fallback_units(s, budgets[s["name"]])
        # '총정리'는 항상 맨 끝(시험 직전)에 — 시간이 남아 채우는 복습은 그 앞에 넣는다
        finals = [u for u in units if "총정리" in u["title"]]
        units = [u for u in units if "총정리" not in u["title"]]
        budget_left = budgets[s["name"]] - sum(u["minutes"] for u in finals)
        filled, total, i = [], 0, 0
        while total < budget_left - 20 and i < 400:
            base = units[i] if i < len(units) else {"title": f"{s['name']} 복습 ({i - len(units) + 1}회차)", "minutes": 50}
            filled.append(dict(base))
            total += base["minutes"]
            i += 1
        links = s.get("links") or []
        finals = [dict(u) for u in finals]
        for j, u in enumerate(filled + finals):  # 연결한 자료·노트를 단위에 번갈아 붙인다
            if links:
                ln = links[j % len(links)]
                u.update(link_type=ln.get("type"), link_id=ln.get("id"), link_label=ln.get("label"))
        queues[s["name"]] = filled
        final_q[s["name"]] = finals

    # 과목별 마지막 공부일 — 그날엔 '총정리'를 먼저 넣는다
    last_day = {s["name"]: max((x for x in study_days if x <= s["_last"]), default=None) for s in subjects}

    # 날짜별 배치: 남은 분량 ÷ 남은 날이 큰 과목(급한 과목)부터, 하루 최대 4개
    days_out = []
    for d in study_days:
        budget = budget_of(d)
        tasks = []
        for s in subjects:
            if last_day[s["name"]] == d:
                for u in final_q[s["name"]]:
                    tasks.append({"subject": s["name"], **u})
                final_q[s["name"]] = []
        active = [s for s in subjects if d <= s["_last"] and queues[s["name"]]]

        def urgency(s):
            # 남은 분량 ÷ 시험 전까지 남은 날 — 분량은 이미 중요도대로 나눠 뒀으니 여기선 '얼마나 밀렸나'만 본다
            left_days = max(1, sum(1 for x in study_days if d <= x <= s["_last"]))
            return sum(u["minutes"] for u in queues[s["name"]]) / left_days

        used = sum(t["minutes"] for t in tasks)
        today = {t["subject"]: 1 for t in tasks}
        while active and used < budget and len(tasks) < 4:
            # 급한 과목 우선, 오늘 이미 한 과목은 뒤로 — 하루에 여러 과목이 섞이게
            active.sort(key=lambda s: urgency(s) / (1 + 0.6 * today.get(s["name"], 0)), reverse=True)
            picked = None
            for s in active:
                u = queues[s["name"]][0]
                if used + u["minutes"] <= budget + 20 or not tasks:
                    picked = s
                    break
            if not picked:
                break
            u = queues[picked["name"]].pop(0)
            tasks.append({"subject": picked["name"], **u})
            used += u["minutes"]
            today[picked["name"]] = today.get(picked["name"], 0) + 1
            if not queues[picked["name"]]:
                active.remove(picked)

        # 시간표(계획): 시작 시각부터 차례로, 할 일 사이 10분 쉬기
        h, m = (int(x) for x in (start_time or "09:00").split(":"))
        slot = max(0, ((h - DAY_START_HOUR) * 60 + m) // SLOT_MIN)
        blocks = {}
        for t in tasks:
            for _ in range(math.ceil(t["minutes"] / SLOT_MIN)):
                if slot < SLOTS_PER_DAY:
                    blocks[str(slot)] = {"s": t["subject"], "k": "plan"}
                slot += 1
            slot += 1
        days_out.append({"date": d.isoformat(), "tasks": tasks, "blocks": blocks})

    summary = {}
    for day in days_out:
        for t in day["tasks"]:
            summary[t["subject"]] = summary.get(t["subject"], 0) + t["minutes"]
    return {"days": days_out, "ai": bool(ai_units), "summary": summary}
