import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { subscribeBroadcast, sendBroadcast } from "../../realtime/chatBus";
import DayView from "./DayView";
import WeekView from "./WeekView";
import MonthView from "./MonthView";
import AiPlanModal from "./AiPlanModal";
import { COLORS, THEMES, addDays, ddayText, monthEnd, monthStart, prettyDate, prettyMonth, today, weekStart } from "./plannerUtils";
import "./planner.css";

/**
 * 스터디 플래너 — 개인용(groupId 없음) / 스터디용(groupId 있음)
 * onOpenLink({ link_type, link_id, link_label }): 할 일에 연결된 자료·노트로 이동
 */
export default function PlannerPage({ user, groupId, groupName, onOpenLink }) {
  const [planner, setPlanner] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [helperBusy, setHelperBusy] = useState("");
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState("day");                 // day | week | month
  const [data, setData] = useState({ days: {}, tasks: [] }); // 지금 보는 범위
  const [aiOpen, setAiOpen] = useState(false);
  const [decoOpen, setDecoOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(null);
  const ws = weekStart(date);
  const rangeStart = mode === "month" ? monthStart(date) : ws;
  const rangeRef = useRef(rangeStart);
  useEffect(() => { rangeRef.current = rangeStart; }, [rangeStart]);

  // 플래너 불러오기 (없으면 서버가 만든다)
  useEffect(() => {
    setPlanner(null); setError("");
    apiFetch(groupId ? `/planner/group/${groupId}` : "/planner/mine").then(setPlanner).catch(err => setError(err.message));
  }, [groupId]);

  const load = useCallback(async (start = rangeRef.current) => {
    if (!planner) return;
    try {
      const isMonth = start === monthStart(start);
      const end = isMonth ? monthEnd(start) : addDays(start, 6);
      const r = await apiFetch(`/planner/${planner.id}/range?start=${start}&end=${end}`);
      if (start !== rangeRef.current) return;
      setData({ days: Object.fromEntries(r.days.map(d => [d.date, d])), tasks: r.tasks });
    } catch (err) { setError(err.message); }
  }, [planner]);

  useEffect(() => { load(rangeStart); }, [load, rangeStart]);

  // 다른 기기·그룹 멤버가 고치면 다시 불러온다
  const topic = planner ? `planner:${planner.id}` : null;
  useEffect(() => {
    if (!topic) return;
    let t;
    return subscribeBroadcast(topic, "changed", ({ by, kind }) => {
      if (by === user.uid && kind !== "planner") return;
      clearTimeout(t);
      t = setTimeout(() => {
        if (kind === "planner") apiFetch(groupId ? `/planner/group/${groupId}` : "/planner/mine").then(setPlanner).catch(() => {});
        else load();
      }, 300);
    });
  }, [topic, user.uid, load, groupId]);
  const announce = (kind = "data") => topic && sendBroadcast(topic, "changed", { by: user.uid, kind });

  // ── 저장 함수 (화면은 먼저 바꾸고 서버에 보낸다) ──
  const api = {
    saveDay: async (d, fields) => {
      setData(cur => ({ ...cur, days: { ...cur.days, [d]: { ...(cur.days[d] || { date: d }), ...fields } } }));
      try {
        await apiFetch(`/planner/${planner.id}/days/${d}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
        announce();
      } catch (err) { setError(err.message); }
    },
    addTask: async (fields) => {
      try {
        const t = await apiFetch(`/planner/${planner.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
        setData(cur => ({ ...cur, tasks: [...cur.tasks, t] }));
        announce();
      } catch (err) { setError(err.message); }
    },
    updateTask: async (id, fields) => {
      setData(cur => ({ ...cur, tasks: cur.tasks.map(t => (t.id === id ? { ...t, ...fields } : t)) }));
      try {
        await apiFetch(`/planner/${planner.id}/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
        announce();
      } catch (err) { setError(err.message); load(); }
    },
    deleteTask: async (id) => {
      setData(cur => ({ ...cur, tasks: cur.tasks.filter(t => t.id !== id) }));
      try {
        await apiFetch(`/planner/${planner.id}/tasks/${id}`, { method: "DELETE" });
        announce();
      } catch (err) { setError(err.message); load(); }
    },
    moveTask: (list, i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const a = list[i], b = list[j];
      const sa = a.sort === b.sort ? b.sort + dir : b.sort;
      api.updateTask(a.id, { sort: sa });
      api.updateTask(b.id, { sort: a.sort });
    },
  };

  // 플래너 도우미: 밀린 할 일 다시 배치 / 약점 복습 넣기
  async function runHelper(kind) {
    setHelperBusy(kind); setError(""); setNotice("");
    try {
      const json = (b) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      if (kind === "reschedule") {
        const r = await apiFetch(`/planner/${planner.id}/reschedule`, json({ today: today(), days: 7 }));
        setNotice(r.moved ? `밀린 할 일 ${r.moved}개를 오늘부터 7일 동안 한가한 날에 다시 넣었어요.` : "지난 2주 동안 밀린 할 일이 없어요. 잘하고 있어요!");
      } else {
        const r = await apiFetch(`/planner/${planner.id}/weak-review`, json({ date, limit: 3 }));
        setNotice(r.added ? `${prettyDate(date)}에 약점 복습 ${r.added}개를 넣었어요: ${r.tasks.map(t => t.title.replace("약점 복습: ", "")).join(", ")}`
          : "넣을 약점이 없어요. 퀴즈·플래시카드를 풀면 헷갈리는 개념을 찾아줘요.");
      }
      load(); announce();
    } catch (err) { setError(err.message); }
    finally { setHelperBusy(""); }
  }

  async function savePlanner(fields) {
    setPlanner(p => ({ ...p, ...fields }));
    try {
      const p = await apiFetch(`/planner/${planner.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      setPlanner(p);
      announce("planner");
    } catch (err) { setError(err.message); }
  }

  if (error && !planner) return <div className="error-banner"><span>{error}</span></div>;
  if (!planner) return <div className="loading-wrap"><div className="spinner" /></div>;

  const subjects = planner.subjects || [];
  const colorOf = (name) => subjects.find(s => s.name === name)?.color || "#9aa0a6";
  const dayTasks = data.tasks.filter(t => t.date === date).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const dday = ddayText(planner.dday);

  return (
    <div className={`planner planner--${planner.theme || "basic"}`}>
      <header className="pl-header">
        <div className="pl-title-row">
          <span className="pl-scope">{groupId ? `${groupName || "스터디"} 플래너` : "개인 플래너"}</span>
          {editTitle === null ? (
            <h1 className="pl-title" onClick={() => setEditTitle(planner.title)} title="눌러서 이름 바꾸기">{planner.title}</h1>
          ) : (
            <input className="pl-title-input" autoFocus value={editTitle} maxLength={64}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={() => { if (editTitle.trim()) savePlanner({ title: editTitle.trim() }); setEditTitle(null); }}
              onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()} />
          )}
          {dday && <span className="pl-dday">{dday}</span>}
        </div>

        <div className="pl-toolbar">
          <div className="pl-nav">
            <button onClick={() => {
              if (mode === "month") { const d = new Date(date.slice(0,4), +date.slice(5,7)-2, 1); setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`); }
              else setDate(addDays(date, mode === "week" ? -7 : -1));
            }} aria-label="이전">‹</button>
            <button className="pl-today" onClick={() => setDate(today())}>오늘</button>
            <button onClick={() => {
              if (mode === "month") { const d = new Date(date.slice(0,4), +date.slice(5,7), 1); setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`); }
              else setDate(addDays(date, mode === "week" ? 7 : 1));
            }} aria-label="다음">›</button>
            <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="날짜 고르기" />
            <span className="pl-range">
              {mode === "week" ? `${prettyDate(ws)} ~ ${prettyDate(addDays(ws, 6))}` : mode === "month" ? prettyMonth(date) : ""}
            </span>
          </div>
          <div className="pl-seg">
            <button className={mode === "day" ? "active" : ""} onClick={() => setMode("day")}>하루</button>
            <button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>일주일</button>
            <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>한달</button>
          </div>
          <button className="btn-secondary btn-sm" onClick={() => setDecoOpen(o => !o)}>꾸미기·과목</button>
          <button className="btn-secondary btn-sm" disabled={!!helperBusy} title="지난 2주 동안 못 끝낸 할 일을 오늘부터 한가한 날에 다시 넣어요"
            onClick={() => runHelper("reschedule")}>{helperBusy === "reschedule" ? "옮기는 중…" : "밀린 할 일 재배치"}</button>
          <button className="btn-secondary btn-sm" disabled={!!helperBusy} title="약점 지도에서 헷갈리는 개념을 골라 이 날 복습 할 일로 넣어요"
            onClick={() => runHelper("weak")}>{helperBusy === "weak" ? "넣는 중…" : "약점 복습 넣기"}</button>
          <button className="btn-primary btn-sm" onClick={() => setAiOpen(true)}>AI 플랜</button>
        </div>

        {decoOpen && (
          <div className="pl-deco">
            <div className="pl-deco-sec">
              <span className="pl-label">테마</span>
              <div className="pl-row-wrap">
                {THEMES.map(([k, label]) => (
                  <button key={k} className={`pl-theme-swatch pl-theme-swatch--${k} ${planner.theme === k ? "active" : ""}`}
                    onClick={() => savePlanner({ theme: k })}>{label}</button>
                ))}
              </div>
            </div>
            <div className="pl-deco-sec">
              <span className="pl-label">D-day</span>
              <div className="pl-row-wrap">
                <input className="input" placeholder="이름 (예: 중간고사)" defaultValue={planner.dday?.label || ""} maxLength={30}
                  onBlur={e => planner.dday?.date && savePlanner({ dday: { label: e.target.value, date: planner.dday.date } })} id="pl-dday-label" />
                <input type="date" className="input" value={planner.dday?.date || ""}
                  onChange={e => savePlanner({ dday: e.target.value
                    ? { label: document.getElementById("pl-dday-label")?.value || "D-day", date: e.target.value } : {} })} />
                {planner.dday?.date && <button className="btn-ghost btn-sm" onClick={() => savePlanner({ dday: {} })}>지우기</button>}
              </div>
            </div>
            <div className="pl-deco-sec">
              <span className="pl-label">과목·색</span>
              <div className="pl-row-wrap">
                {subjects.map((s, i) => (
                  <span key={s.name} className="pl-subj-edit" style={{ "--c": s.color }}>
                    <input type="color" value={s.color} aria-label={`${s.name} 색`}
                      onChange={e => savePlanner({ subjects: subjects.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
                    {s.name}
                    <button onClick={() => savePlanner({ subjects: subjects.filter((_, j) => j !== i) })} aria-label={`${s.name} 빼기`}>✕</button>
                  </span>
                ))}
                <input className="input pl-subj-new" placeholder="과목 추가 + Enter" maxLength={40}
                  onKeyDown={e => {
                    const v = e.currentTarget.value.trim();
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && v && !subjects.some(s => s.name === v)) {
                      savePlanner({ subjects: [...subjects, { name: v, color: COLORS[subjects.length % COLORS.length] }] });
                      e.currentTarget.value = "";
                    }
                  }} />
              </div>
            </div>
          </div>
        )}
      </header>

      {notice && <div className="callout pl-notice"><span style={{ flex: 1 }}>{notice}</span><button className="btn-ghost btn-sm" onClick={() => setNotice("")}>닫기</button></div>}
      {error && <div className="error-banner"><span style={{ flex: 1 }}>{error}</span><button className="btn-ghost" onClick={() => setError("")}>닫기</button></div>}

      <div className="pl-paper">
        {mode === "day" ? (
          <DayView date={date} day={data.days[date] || { date }} tasks={dayTasks} subjects={subjects}
            colorOf={colorOf} api={api} plannerId={planner.id} onOpenLink={onOpenLink} />
        ) : mode === "week" ? (
          <WeekView start={ws} days={data.days} tasks={data.tasks} colorOf={colorOf}
            onPickDay={(d) => { setDate(d); setMode("day"); }}
            onToggle={(id, done) => api.updateTask(id, { done })} onOpenLink={onOpenLink} />
        ) : (
          <MonthView date={date} days={data.days} tasks={data.tasks} colorOf={colorOf}
            onPickDay={(d) => { setDate(d); setMode("day"); }} />
        )}
      </div>

      {aiOpen && (
        <AiPlanModal planner={planner} startDate={date} onClose={() => setAiOpen(false)}
          onSubjectsChange={(subs) => savePlanner({ subjects: subs })}
          onApplied={(first) => { setAiOpen(false); if (first) setDate(first); load(weekStart(first || date)); announce(); }} />
      )}
    </div>
  );
}
