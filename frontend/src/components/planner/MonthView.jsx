import { addDays, fromKey, monthEnd, monthStart, today, toKey, WEEKDAYS } from "./plannerUtils";

export default function MonthView({ date, days, tasks, colorOf, onPickDay }) {
  const ms = monthStart(date);
  const me = monthEnd(date);
  const todayKey = today();

  // 달력 그리드: 월요일 시작, 앞뒤 빈 칸 채우기
  const firstDay = fromKey(ms);
  const startOffset = (firstDay.getDay() + 6) % 7; // 월=0
  const totalDays = fromKey(me).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    cells.push(toKey(new Date(firstDay.getFullYear(), firstDay.getMonth(), d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="pl-month">
      <div className="pl-month-head">
        {WEEKDAYS.map(d => <span key={d} className="pl-month-dow">{d}</span>)}
      </div>
      <div className="pl-month-grid">
        {cells.map((k, i) => {
          if (!k) return <div key={i} className="pl-month-cell pl-month-cell--empty" />;
          const dayTasks = tasks.filter(t => t.date === k);
          const done = dayTasks.filter(t => t.done).length;
          const total = dayTasks.length;
          const day = days[k];
          const sticker = day?.sticker;
          const isToday = k === todayKey;
          const isSelected = k === date;

          // 과목 색 점
          const subjectColors = [...new Set(dayTasks.map(t => t.subject).filter(Boolean))].slice(0, 4).map(colorOf);

          return (
            <button key={k} className={`pl-month-cell ${isToday ? "pl-month-cell--today" : ""} ${isSelected ? "pl-month-cell--selected" : ""}`}
              onClick={() => onPickDay(k)}>
              <span className="pl-month-day">{fromKey(k).getDate()}</span>
              {sticker && <span className="pl-month-sticker">{sticker}</span>}
              {subjectColors.length > 0 && (
                <span className="pl-month-dots">
                  {subjectColors.map((c, ci) => <span key={ci} className="pl-month-dot" style={{ background: c }} />)}
                </span>
              )}
              {total > 0 && (
                <span className={`pl-month-progress ${done === total ? "pl-month-progress--done" : ""}`}>
                  {done}/{total}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
