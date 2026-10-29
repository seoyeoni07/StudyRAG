// 플래너 공용 도우미 — 날짜·10분 칸 계산

export const SLOT_MIN = 10;
export const DAY_START_HOUR = 6;          // 시간표는 06:00부터
export const HOURS = 20;                  // 06:00 ~ 다음날 02:00
export const SLOTS = HOURS * 6;

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
export const COLORS = ["#4f8cff", "#2fb67c", "#f2994a", "#bb6bd9", "#eb5757", "#00a3bf", "#e2b93b", "#6c7a89"];
export const STICKERS = ["🔥", "⭐", "💯", "📚", "✏️", "☕", "🎯", "💪", "🌱", "🍀", "😴", "🥳", "❤️", "🌙", "☀️", "🧠"];
export const THEMES = [
  ["basic", "기본"], ["pastel", "파스텔"], ["grid", "모눈종이"], ["kraft", "크라프트지"], ["dark", "다크"],
];

const pad = (n) => String(n).padStart(2, "0");
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const today = () => toKey(new Date());
export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
/** 월요일 시작 주 */
export const weekStart = (k) => { const d = fromKey(k); const wd = (d.getDay() + 6) % 7; return addDays(k, -wd); };
export const weekdayIdx = (k) => (fromKey(k).getDay() + 6) % 7;
export const prettyDate = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[weekdayIdx(k)]})`; };

export const slotLabel = (slot) => {
  const total = DAY_START_HOUR * 60 + slot * SLOT_MIN;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
};

export const fmtMin = (m) => {
  if (!m) return "0분";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`;
};

/** 시간표에서 과목별 계획·실제 분 */
export function timelineTotals(timeline = {}) {
  const out = {};
  let plan = 0, done = 0;
  for (const v of Object.values(timeline)) {
    const o = (out[v.s] ||= { plan: 0, done: 0 });
    if (v.k === "done") { o.done += SLOT_MIN; done += SLOT_MIN; } else { o.plan += SLOT_MIN; plan += SLOT_MIN; }
  }
  return { bySubject: out, plan, done };
}

export const ddayText = (dday) => {
  if (!dday?.date) return null;
  const diff = Math.round((fromKey(dday.date) - fromKey(today())) / 86400000);
  return `${dday.label || "D-day"} ${diff === 0 ? "D-DAY" : diff > 0 ? `D-${diff}` : `D+${-diff}`}`;
};
