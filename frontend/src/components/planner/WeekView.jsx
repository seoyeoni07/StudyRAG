import { addDays, fmtMin, fromKey, timelineTotals, today, WEEKDAYS } from "./plannerUtils";

/** 일주일 한눈에: 요일별 할 일·공부 시간, 아래에 과목별 주간 합계 */
export default function WeekView({ start, days, tasks, colorOf, onPickDay, onToggle, onOpenLink }) {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const week = {};
  for (const k of keys) {
    const t = timelineTotals(days[k]?.timeline);
    for (const [s, v] of Object.entries(t.bySubject)) {
      const o = (week[s] ||= { plan: 0, done: 0 });
      o.plan += v.plan; o.done += v.done;
    }
  }
  const weekRows = Object.entries(week).sort((a, b) => b[1].done - a[1].done);
  const max = Math.max(60, ...weekRows.map(([, v]) => v.plan + v.done));
  const t0 = today();

  return (
    <div className="pl-week">
      <div className="pl-week-grid">
        {keys.map((k, i) => {
          const list = tasks.filter(t => t.date === k);
          const tot = timelineTotals(days[k]?.timeline);
          return (
            <div key={k} className={`pl-week-col ${k === t0 ? "pl-week-col--today" : ""} ${i >= 5 ? "pl-week-col--weekend" : ""}`}>
              <button className="pl-week-head" onClick={() => onPickDay(k)} title="이 날 열기">
                <span className="pl-week-wd">{WEEKDAYS[i]}</span>
                <span className="pl-week-d">{fromKey(k).getDate()}</span>
                {days[k]?.stickers?.length > 0 && <span className="pl-week-stk">{days[k].stickers.slice(0, 3).join("")}</span>}
              </button>
              {days[k]?.goal && <p className="pl-week-goal">🎯 {days[k].goal}</p>}
              <ul className="pl-week-tasks">
                {list.map(t => (
                  <li key={t.id} className={t.done ? "done" : ""}>
                    <input type="checkbox" checked={t.done} onChange={e => onToggle(t.id, e.target.checked)} aria-label="완료" />
                    <span className="pl-dot" style={{ "--c": colorOf(t.subject) }} />
                    <span className="pl-week-title" title={t.title}>{t.title}</span>
                    {t.link_type && (
                      <button className="pl-week-link" title={t.link_label} onClick={() => onOpenLink(t)}>
                        {t.link_type === "doc" ? "📄" : "📝"}
                      </button>
                    )}
                  </li>
                ))}
                {list.length === 0 && <li className="pl-empty">—</li>}
              </ul>
              <div className="pl-week-foot">
                <span className="pl-mini-bar">
                  {Object.entries(tot.bySubject).map(([s, v]) => (
                    <span key={s} style={{ flex: v.done + v.plan, "--c": colorOf(s), opacity: v.done ? 1 : 0.35 }} />
                  ))}
                </span>
                <span className="pl-muted">{tot.done ? fmtMin(tot.done) : tot.plan ? `계획 ${fmtMin(tot.plan)}` : ""}</span>
              </div>
            </div>
          );
        })}
      </div>

      <section className="pl-box">
        <div className="pl-box-head"><span>이번 주 과목별 공부 시간</span></div>
        {weekRows.length === 0 ? <p className="pl-empty">하루 화면에서 시간표를 칠하면 주간 합계가 보여요</p> : weekRows.map(([name, v]) => (
          <div key={name} className="pl-bar-row">
            <span className="pl-bar-name" style={{ "--c": colorOf(name) }}>{name}</span>
            <span className="pl-bar">
              <span className="pl-bar-plan" style={{ width: `${(v.plan + v.done) / max * 100}%`, "--c": colorOf(name) }} />
              <span className="pl-bar-done" style={{ width: `${v.done / max * 100}%`, "--c": colorOf(name) }} />
            </span>
            <span className="pl-muted">{fmtMin(v.done)} / {fmtMin(v.plan + v.done)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
