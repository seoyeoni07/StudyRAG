import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api";
import { COLORS, WEEKDAYS, addDays, fmtMin, prettyDate, today } from "./plannerUtils";

/**
 * ✨ AI로 계획 세우기
 * 1) 기간·과목·시간 고르기 → 2) 미리보기(필요 없는 할 일 빼기) → 3) 플래너에 적용
 */
export default function AiPlanModal({ planner, startDate, onClose, onApplied, onSubjectsChange }) {
  const [linkables, setLinkables] = useState({ docs: [], notes: [] });
  const [start, setStart] = useState(startDate || today());
  const [end, setEnd] = useState(addDays(startDate || today(), 6));
  const [subjects, setSubjects] = useState(() => planner.subjects.map(s => ({
    name: s.name, on: true, priority: 2, exam_date: planner.dday?.date || "", doc_ids: [], note_ids: [],
  })));
  const [newSubj, setNewSubj] = useState("");
  const [dailyH, setDailyH] = useState(3);
  const [weekendH, setWeekendH] = useState(4);
  const [offDays, setOffDays] = useState([]);
  const [startTime, setStartTime] = useState("09:00");
  const [request, setRequest] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [replace, setReplace] = useState(true);
  const [openLinks, setOpenLinks] = useState(null);

  useEffect(() => {
    apiFetch(`/planner/${planner.id}/linkables`).then(setLinkables).catch(() => {});
  }, [planner.id]);

  const quick = [
    ["1주", 6], ["2주", 13], ["4주", 27],
    ...(planner.dday?.date && planner.dday.date > start ? [[`${planner.dday.label || "D-day"}까지`, null]] : []),
  ];

  const chosen = subjects.filter(s => s.on && s.name.trim());

  function addSubject() {
    const name = newSubj.trim();
    if (!name || subjects.some(s => s.name === name)) return;
    setSubjects(prev => [...prev, { name, on: true, priority: 2, exam_date: "", doc_ids: [], note_ids: [] }]);
    setNewSubj("");
  }
  const setSubj = (i, patch) => setSubjects(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  async function generate() {
    setBusy(true); setError(""); setPreview(null);
    try {
      const res = await apiFetch(`/planner/${planner.id}/ai-plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start, end, use_ai: useAi, request, start_time: startTime, off_days: offDays,
          daily_minutes: Math.round(dailyH * 60), weekend_minutes: Math.round(weekendH * 60),
          subjects: chosen.map(s => ({ name: s.name.trim(), priority: s.priority, exam_date: s.exam_date || null,
            doc_ids: s.doc_ids, note_ids: s.note_ids })),
        }),
      }, 180_000);
      setPreview(res);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      // 새로 넣은 과목은 플래너 과목 목록(색)에도 추가
      const known = new Set(planner.subjects.map(s => s.name));
      const added = chosen.filter(s => !known.has(s.name.trim()));
      if (added.length) {
        await onSubjectsChange([...planner.subjects,
          ...added.map((s, i) => ({ name: s.name.trim(), color: COLORS[(planner.subjects.length + i) % COLORS.length] }))]);
      }
      await apiFetch(`/planner/${planner.id}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: preview.days, replace }),
      });
      onApplied(preview.days[0]?.date);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const removeTask = (di, ti) => setPreview(p => ({
    ...p, days: p.days.map((d, i) => (i === di ? { ...d, tasks: d.tasks.filter((_, j) => j !== ti) } : d)),
  }));

  const total = useMemo(() => preview?.days.reduce((n, d) => n + d.tasks.reduce((m, t) => m + t.minutes, 0), 0) || 0, [preview]);

  return (
    <div className="pl-modal-overlay" onClick={onClose}>
      <div className="pl-modal" onClick={e => e.stopPropagation()}>
        <div className="pl-modal-head">
          <span>✨ AI로 공부 계획 세우기</span>
          <button className="btn-ghost" onClick={onClose}>닫기</button>
        </div>
        {error && <div className="error-banner"><span>{error}</span></div>}

        {!preview ? (
          <div className="pl-ai-form">
            <div className="pl-field">
              <span className="pl-label">기간</span>
              <div className="pl-row-wrap">
                <input type="date" className="input" value={start} onChange={e => setStart(e.target.value)} />
                <span>~</span>
                <input type="date" className="input" value={end} min={start} onChange={e => setEnd(e.target.value)} />
                {quick.map(([label, n]) => (
                  <button key={label} className="pl-chip" onClick={() => setEnd(n == null ? addDays(planner.dday.date, -1) : addDays(start, n))}>{label}</button>
                ))}
              </div>
            </div>

            <div className="pl-field">
              <span className="pl-label">과목</span>
              <div className="pl-subjects">
                {subjects.map((s, i) => (
                  <div key={s.name + i} className={`pl-subj-card ${s.on ? "" : "off"}`}>
                    <label className="pl-subj-top">
                      <input type="checkbox" checked={s.on} onChange={e => setSubj(i, { on: e.target.checked })} />
                      <strong>{s.name}</strong>
                    </label>
                    {s.on && (
                      <div className="pl-subj-opts">
                        <label>중요도
                          <select value={s.priority} onChange={e => setSubj(i, { priority: Number(e.target.value) })}>
                            <option value={1}>낮음</option><option value={2}>보통</option><option value={3}>높음</option>
                          </select>
                        </label>
                        <label>시험일 <input type="date" value={s.exam_date} onChange={e => setSubj(i, { exam_date: e.target.value })} /></label>
                        <button className="pl-chip" onClick={() => setOpenLinks(openLinks === i ? null : i)}>
                          📎 자료·노트 {s.doc_ids.length + s.note_ids.length ? `(${s.doc_ids.length + s.note_ids.length})` : "연결"}
                        </button>
                      </div>
                    )}
                    {s.on && openLinks === i && (
                      <div className="pl-subj-links">
                        {linkables.docs.map(d => (
                          <label key={d.id}><input type="checkbox" checked={s.doc_ids.includes(d.id)}
                            onChange={() => setSubj(i, { doc_ids: toggleIn(s.doc_ids, d.id) })} /> 📄 {d.label.replace(/\.pdf$/i, "")}</label>
                        ))}
                        {linkables.notes.map(n => (
                          <label key={n.id}><input type="checkbox" checked={s.note_ids.includes(n.id)}
                            onChange={() => setSubj(i, { note_ids: toggleIn(s.note_ids, n.id) })} /> {n.icon || "📝"} {n.label}</label>
                        ))}
                        {!linkables.docs.length && !linkables.notes.length && <p className="pl-empty">연결할 자료·노트가 없어요</p>}
                        <p className="pl-muted">고른 자료의 핵심 개념·오답 수를 보고 계획을 짜고, 할 일에 자동으로 연결돼요.</p>
                      </div>
                    )}
                  </div>
                ))}
                <div className="pl-row-wrap">
                  <input className="input" placeholder="과목 추가 (예: 자료구조)" value={newSubj}
                    onChange={e => setNewSubj(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addSubject(); }} />
                  <button className="btn-secondary btn-sm" onClick={addSubject} disabled={!newSubj.trim()}>추가</button>
                </div>
              </div>
            </div>

            <div className="pl-field pl-field--grid">
              <label>평일 공부 시간 <span className="pl-row-wrap"><input type="number" className="input" min="0.5" max="16" step="0.5"
                value={dailyH} onChange={e => setDailyH(Number(e.target.value))} /> 시간</span></label>
              <label>주말 공부 시간 <span className="pl-row-wrap"><input type="number" className="input" min="0" max="16" step="0.5"
                value={weekendH} onChange={e => setWeekendH(Number(e.target.value))} /> 시간</span></label>
              <label>공부 시작 시각 <input type="time" className="input" value={startTime} onChange={e => setStartTime(e.target.value)} /></label>
            </div>

            <div className="pl-field">
              <span className="pl-label">쉬는 요일</span>
              <div className="pl-row-wrap">
                {WEEKDAYS.map((w, i) => (
                  <button key={w} className={`pl-chip ${offDays.includes(i) ? "active" : ""}`} onClick={() => setOffDays(d => toggleIn(d, i))}>{w}</button>
                ))}
              </div>
            </div>

            <div className="pl-field">
              <span className="pl-label">AI에게 하고 싶은 말 (선택)</span>
              <textarea className="input" rows={2} value={request} maxLength={300}
                placeholder="예: 오전엔 어려운 과목, 저녁엔 복습 위주로 / 금요일은 가볍게" onChange={e => setRequest(e.target.value)} />
            </div>

            <label className="pl-check"><input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
              AI로 공부 단위 만들기 (끄면 자료의 핵심 개념으로 바로 배치 — 더 빠름)</label>

            <div className="pl-modal-foot">
              <button className="btn-primary" onClick={generate} disabled={busy || !chosen.length || !start || !end || end < start}>
                {busy ? "계획 세우는 중… (최대 1분)" : "계획 만들기"}
              </button>
            </div>
          </div>
        ) : (
          <div className="pl-ai-preview">
            <p className="pl-muted">
              {preview.ai ? "AI가 만든 공부 단위로" : "자료의 핵심 개념으로"} {preview.days.length}일 계획을 만들었어요 · 총 {fmtMin(total)}.
              필요 없는 할 일은 ✕로 빼고 적용하세요. 적용한 뒤에도 자유롭게 고칠 수 있어요.
            </p>
            <div className="pl-preview-summary">
              {Object.entries(preview.summary).map(([s, m]) => <span key={s} className="pl-chip">{s} {fmtMin(m)}</span>)}
            </div>
            <div className="pl-preview-days">
              {preview.days.map((d, di) => (
                <div key={d.date} className="pl-preview-day">
                  <strong>{prettyDate(d.date)}</strong>
                  <ul>
                    {d.tasks.map((t, ti) => (
                      <li key={ti}>
                        <span className="pl-preview-subj">{t.subject}</span> {t.title}
                        <span className="pl-muted"> · {t.minutes}분{t.link_label ? ` · 📎 ${t.link_label.replace(/\.pdf$/i, "")}` : ""}</span>
                        <button className="pl-x" onClick={() => removeTask(di, ti)} aria-label="빼기">✕</button>
                      </li>
                    ))}
                    {d.tasks.length === 0 && <li className="pl-empty">쉬는 날</li>}
                  </ul>
                </div>
              ))}
            </div>
            <label className="pl-check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
              이 기간에 예전에 AI가 넣은 계획은 지우고 새로 넣기 (내가 직접 쓴 할 일·칠한 ‘실제’ 시간은 그대로)</label>
            <div className="pl-modal-foot">
              <button className="btn-secondary" onClick={() => setPreview(null)} disabled={busy}>← 조건 바꾸기</button>
              <button className="btn-primary" onClick={apply} disabled={busy}>{busy ? "적용 중…" : "플래너에 적용"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
