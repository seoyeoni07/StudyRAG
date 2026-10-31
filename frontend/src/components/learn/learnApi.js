import { apiFetch } from "../../api";

const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const pad = (n) => String(n).padStart(2, "0");
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** 내 개인 플래너 오늘 칸에 할 일 추가 */
export async function addToPlanner(task, date = todayKey()) {
  const p = await apiFetch("/planner/mine");
  return apiFetch(`/planner/${p.id}/tasks`, json({ date, ...task }));
}

/** 카드 만들기 (AI, 30초~1분) → 만든 카드 목록 */
export const generateCards = (body) => apiFetch("/learn/cards/generate", json(body), 180_000);

/** 퀴즈 만들기 (개념 하나만 / 고른 글로만) → { session_id, questions } */
export const generateQuiz = (body) => apiFetch("/quiz/generate", json(body), 180_000);

export { json };
