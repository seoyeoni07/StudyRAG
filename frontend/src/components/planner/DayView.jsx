import { useEffect, useRef, useState } from "react";
import LinkPicker from "./LinkPicker";
import {
  HOURS, DAY_START_HOUR, STICKERS, fmtMin, prettyDate, slotLabel, timelineTotals,
} from "./plannerUtils";

/** 저장을 잠깐 모아서 한 번에 (타이핑·드래그할 때마다 서버에 보내지 않게) */
function useDebounced(fn, ms) {
  const t = useRef(null);
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => () => clearTimeout(t.current), []);
  return (...args) => { clearTimeout(t.current); t.current = setTimeout(() => latest.current(...args), ms); };
}

// ── 할 일 ────────────────────────────────────────────────────────────────────

function TaskRow({ task, subjects, colorOf, onUpdate, onDelete, onMove, onLink, onOpenLink, first, last }) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  return (
    <li className={`pl-task ${task.done ? "pl-task--done" : ""}`}>
      <input type="checkbox" checked={task.done} onChange={e => onUpdate({ done: e.target.checked })} aria-label="완료" />
      <select className="pl-subject-chip" value={task.subject || ""}
        style={{ "--c": colorOf(task.subject) }}
        onChange={e => onUpdate({ subject: e.target.value || null })} aria-label="과목">
        <option value="">과목 없음</option>
        {subjects.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>
      <input className="pl-task-title" value={title} onChange={e => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && onUpdate({ title: title.trim() })}
        onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()} />
      <input className="pl-task-min" type="number" min="0" step="10" value={task.minutes ?? ""} placeholder="분"
        onChange={e => onUpdate({ minutes: e.target.value === "" ? null : Number(e.target.value) })} aria-label="예상 시간(분)" />
      {task.link_type ? (
        <button className="pl-link-chip" title="눌러서 열기" onClick={() => onOpenLink(task)}>
          {task.link_type === "doc" ? "📄" : "📝"} {(task.link_label || "").replace(/\.pdf$/i, "")}
        </button>
      ) : null}
      <span className="pl-task-tools">
        <button title={task.link_type ? "연결 바꾸기" : "자료·노트 연결"} onClick={onLink}>🔗</button>
        <button title="위로" disabled={first} onClick={() => onMove(-1)}>↑</button>
        <button title="아래로" disabled={last} onClick={() => onMove(1)}>↓</button>
        <button title="삭제" onClick={onDelete}>✕</button>
      </span>
    </li>
  );
}

function TaskList({ date, tasks, subjects, colorOf, api, plannerId, onOpenLink }) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [minutes, setMinutes] = useState("");
  const [linking, setLinking] = useState(null);

  function add() {
    if (!title.trim()) return;
    api.addTask({ date, title: title.trim(), subject: subject || null, minutes: minutes ? Number(minutes) : null,
      sort: (tasks.at(-1)?.sort ?? -1) + 1 });
    setTitle(""); setMinutes("");
  }

  const doneCount = tasks.filter(t => t.done).length;
  return (
    <section className="pl-box pl-todo">
      <div className="pl-box-head">
        <span>할 일</span>
        <span className="pl-muted">{tasks.length ? `${doneCount}/${tasks.length} 완료` : ""}</span>
      </div>
      <ul className="pl-tasks">
        {tasks.map((t, i) => (
          <TaskRow key={t.id} task={t} subjects={subjects} colorOf={colorOf}
            first={i === 0} last={i === tasks.length - 1}
            onUpdate={(f) => api.updateTask(t.id, f)}
            onDelete={() => api.deleteTask(t.id)}
            onMove={(dir) => api.moveTask(tasks, i, dir)}
            onLink={() => setLinking(t)}
            onOpenLink={onOpenLink} />
        ))}
        {tasks.length === 0 && <li className="pl-empty">할 일을 추가하거나 AI로 계획을 세워보세요</li>}
      </ul>
      <div className="pl-add-task">
        <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="과목">
          <option value="">과목</option>
          {subjects.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <input className="input" placeholder="할 일 추가 (Enter)" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }} />
        <input className="input pl-min-input" type="number" min="0" step="10" placeholder="분" value={minutes}
          onChange={e => setMinutes(e.target.value)} />
        <button className="btn-primary btn-sm" onClick={add} disabled={!title.trim()}>추가</button>
      </div>
      {linking && (
        <LinkPicker plannerId={plannerId} current={linking}
          onPick={(link) => { api.updateTask(linking.id, link || { link_type: null }); setLinking(null); }}
          onClose={() => setLinking(null)} />
      )}
    </section>
  );
}

// ── 10분 시간표 ──────────────────────────────────────────────────────────────

function Timeline({ timeline, subjects, colorOf, onChange }) {
  const [brush, setBrush] = useState({ subject: subjects[0]?.name || "", kind: "done" });
  const [local, setLocal] = useState(timeline);
  const localRef = useRef(timeline);
  const drag = useRef(null); // { erase: bool, changed: bool }
  useEffect(() => { setLocal(timeline); localRef.current = timeline; }, [timeline]);
  useEffect(() => {
    if (!brush.subject && subjects[0]) setBrush(b => ({ ...b, subject: subjects[0].name }));
  }, [subjects, brush.subject]);

  function paint(slot, erase) {
    const cur = localRef.current;
    const want = erase || brush.kind === "erase" ? null : (brush.subject ? { s: brush.subject, k: brush.kind } : undefined);
    if (want === undefined) return;
    const had = cur[slot];
    if (want === null ? !had : had && had.s === want.s && had.k === want.k) return; // 바뀐 게 없으면 그대로
    const next = { ...cur };
    if (want === null) delete next[slot]; else next[slot] = want;
    localRef.current = next;
    setLocal(next);
    if (drag.current) drag.current.changed = true;
  }
  const slotAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const s = el?.closest?.("[data-slot]")?.dataset.slot;
    return s == null ? null : s;
  };

  function down(e) {
    const slot = slotAt(e);
    if (slot == null) return;
    e.preventDefault();
    const cur = local[slot];
    // 이미 같은 붓으로 칠한 칸에서 시작하면 지우면서 드래그
    const erase = brush.kind !== "erase" && cur && cur.s === brush.subject && cur.k === brush.kind;
    drag.current = { erase, changed: false };
    paint(slot, erase);
  }
  function move(e) {
    if (!drag.current) return;
    const slot = slotAt(e);
    if (slot != null) paint(slot, drag.current.erase);
  }
  function up() {
    if (!drag.current) return;
    const changed = drag.current.changed;
    drag.current = null;
    if (changed) onChange(localRef.current);   // 드래그가 끝났을 때 한 번만 저장
  }

  const rows = [];
  for (let h = 0; h < HOURS; h++) {
    const cells = [];
    for (let m = 0; m < 6; m++) {
      const slot = String(h * 6 + m);
      const v = local[slot];
      cells.push(
        <span key={slot} data-slot={slot} title={`${slotLabel(+slot)}${v ? ` · ${v.s} (${v.k === "done" ? "실제" : "계획"})` : ""}`}
          className={`pl-cell ${v ? `pl-cell--${v.k}` : ""}`}
          style={v ? { "--c": colorOf(v.s) } : undefined} />
      );
    }
    rows.push(
      <div key={h} className="pl-row">
        <span className="pl-hour">{String((DAY_START_HOUR + h) % 24).padStart(2, "0")}</span>
        {cells}
      </div>
    );
  }

  return (
    <section className="pl-box pl-timeline">
      <div className="pl-box-head">
        <span>시간표</span>
        <span className="pl-muted">드래그해서 칠하기 · 같은 칸을 다시 칠하면 지워져요</span>
      </div>
      <div className="pl-brush">
        {subjects.map(s => (
          <button key={s.name} className={`pl-brush-subj ${brush.subject === s.name && brush.kind !== "erase" ? "active" : ""}`}
            style={{ "--c": s.color }} onClick={() => setBrush(b => ({ subject: s.name, kind: b.kind === "erase" ? "done" : b.kind }))}>
            {s.name}
          </button>
        ))}
        {subjects.length === 0 && <span className="pl-muted">위쪽 ‘과목’에서 과목을 먼저 추가하세요</span>}
        <span className="pl-brush-kind">
          <button className={brush.kind === "plan" ? "active" : ""} onClick={() => setBrush(b => ({ ...b, kind: "plan" }))} title="계획 (연하게)">계획</button>
          <button className={brush.kind === "done" ? "active" : ""} onClick={() => setBrush(b => ({ ...b, kind: "done" }))} title="실제로 한 시간 (진하게)">실제</button>
          <button className={brush.kind === "erase" ? "active" : ""} onClick={() => setBrush(b => ({ ...b, kind: "erase" }))} title="지우개">지우개</button>
        </span>
      </div>
      <div className="pl-grid" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}>
        {rows}
      </div>
    </section>
  );
}

// ── 하루 화면 ────────────────────────────────────────────────────────────────

export default function DayView({ date, day, tasks, subjects, colorOf, api, plannerId, onOpenLink }) {
  const [goal, setGoal] = useState(day.goal || "");
  const [memo, setMemo] = useState(day.memo || "");
  const [stickerOpen, setStickerOpen] = useState(false);
  useEffect(() => { setGoal(day.goal || ""); setMemo(day.memo || ""); }, [date, day.goal, day.memo]);
  const saveGoal = useDebounced((v) => api.saveDay(date, { goal: v }), 700);
  const saveMemo = useDebounced((v) => api.saveDay(date, { memo: v }), 900);

  const totals = timelineTotals(day.timeline);
  const stickers = day.stickers || [];
  const subjectRows = Object.entries(totals.bySubject).sort((a, b) => (b[1].done + b[1].plan) - (a[1].done + a[1].plan));
  const maxMin = Math.max(60, ...subjectRows.map(([, v]) => Math.max(v.done, v.plan)));

  return (
    <div className="pl-day">
      <div className="pl-day-head">
        <div className="pl-date">{prettyDate(date)}</div>
        <label className="pl-goal">
          <span>오늘의 목표</span>
          <input value={goal} placeholder="오늘 꼭 끝낼 것 한 가지" maxLength={200}
            onChange={e => { setGoal(e.target.value); saveGoal(e.target.value); }} />
        </label>
        <div className="pl-total">
          <span className="pl-total-num">{fmtMin(totals.done)}</span>
          <span className="pl-muted">실제 공부 · 계획 {fmtMin(totals.plan + totals.done)}</span>
        </div>
      </div>

      <div className="pl-day-body">
        <TaskList date={date} tasks={tasks} subjects={subjects} colorOf={colorOf} api={api}
          plannerId={plannerId} onOpenLink={onOpenLink} />
        <Timeline key={date} timeline={day.timeline || {}} subjects={subjects} colorOf={colorOf}
          onChange={(tl) => api.saveDay(date, { timeline: tl })} />
      </div>

      <div className="pl-day-foot">
        <section className="pl-box">
          <div className="pl-box-head"><span>과목별 시간</span></div>
          {subjectRows.length === 0 ? <p className="pl-empty">시간표를 칠하면 여기서 합계를 보여줘요</p> : subjectRows.map(([name, v]) => (
            <div key={name} className="pl-bar-row">
              <span className="pl-bar-name" style={{ "--c": colorOf(name) }}>{name}</span>
              <span className="pl-bar">
                <span className="pl-bar-plan" style={{ width: `${(v.plan + v.done) / maxMin * 100}%`, "--c": colorOf(name) }} />
                <span className="pl-bar-done" style={{ width: `${v.done / maxMin * 100}%`, "--c": colorOf(name) }} />
              </span>
              <span className="pl-muted">{fmtMin(v.done)}</span>
            </div>
          ))}
        </section>
        <section className="pl-box pl-memo">
          <div className="pl-box-head">
            <span>오늘의 한마디 · 메모</span>
            <button className="btn-ghost btn-sm" onClick={() => setStickerOpen(o => !o)}>스티커 붙이기</button>
          </div>
          {stickerOpen && (
            <div className="pl-sticker-palette">
              {STICKERS.map(s => (
                <button key={s} onClick={() => api.saveDay(date, { stickers: [...stickers, s].slice(-30) })}>{s}</button>
              ))}
            </div>
          )}
          {stickers.length > 0 && (
            <div className="pl-stickers">
              {stickers.map((s, i) => (
                <button key={i} title="눌러서 떼기"
                  onClick={() => api.saveDay(date, { stickers: stickers.filter((_, j) => j !== i) })}>{s}</button>
              ))}
            </div>
          )}
          <textarea value={memo} placeholder="오늘 공부하면서 느낀 점, 내일 할 일…" maxLength={4000}
            onChange={e => { setMemo(e.target.value); saveMemo(e.target.value); }} />
        </section>
      </div>
    </div>
  );
}
