import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { addToPlanner } from "./learnApi";
import "./learn.css";

export const LEVELS = {
  good: { label: "잘 앎", cls: "good" },
  mid:  { label: "헷갈림", cls: "mid" },
  weak: { label: "모름", cls: "weak" },
  none: { label: "아직 안 풀어봄", cls: "none" },
};

/**
 * 개념 약점 지도: 퀴즈·카드·그룹 문제 결과로 개념마다 이해도를 보여준다.
 * onQuiz(concept): 그 개념만 퀴즈, onCards(concept): 그 개념 카드 만들기
 */
export default function MasteryMap({ docId, filename, onQuiz, onCards, onGoQuiz, refreshKey = 0, onToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let off = false;
    apiFetch(`/learn/mastery?doc_id=${docId}`).then(d => !off && setData(d)).catch(e => !off && setError(e.message));
    return () => { off = true; };
  }, [docId, refreshKey]);

  async function act(kind, c) {
    setBusy(`${kind}:${c.concept}`);
    try {
      if (kind === "quiz") await onQuiz?.(c.concept);
      else if (kind === "cards") await onCards?.(c.concept);
      else if (kind === "plan") {
        await addToPlanner({ title: `약점 복습: ${c.concept}`, minutes: c.level === "weak" ? 30 : 20,
          link_type: "doc", link_id: docId, link_label: filename });
        onToast?.("오늘 플래너에 복습 할 일을 넣었어요");
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  if (error && !data) return <div className="error-banner"><span>{error}</span></div>;
  if (!data) return <div className="loading-wrap"><div className="spinner" /></div>;

  const rows = data.concepts.filter(c => filter === "all" || c.level === filter);
  const total = data.concepts.length || 1;

  if (!data.concepts.length) {
    return (
      <div className="lr-empty-box">
        <p><strong>아직 이해도를 잴 개념이 없어요.</strong></p>
        <p className="lr-muted">‘요약’을 만들거나 ‘퀴즈’를 한 번 풀면 개념마다 잘 아는지·헷갈리는지 보여줘요.</p>
        <button className="btn-primary btn-sm" onClick={onGoQuiz}>퀴즈 풀러 가기</button>
      </div>
    );
  }

  return (
    <div className="lr-mastery">
      {error && <div className="error-banner"><span>{error}</span><button className="btn-ghost btn-sm" onClick={() => setError("")}>닫기</button></div>}
      <div className="lr-bar" role="img" aria-label="개념 이해도 분포">
        {["good", "mid", "weak", "none"].map(k => data.counts[k] > 0 && (
          <span key={k} className={`lr-bar-seg lr-lv-${k}`} style={{ flex: data.counts[k] }} title={`${LEVELS[k].label} ${data.counts[k]}개`} />
        ))}
      </div>
      <div className="lr-legend">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 {data.concepts.length}</button>
        {["weak", "mid", "good", "none"].map(k => (
          <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)} disabled={!data.counts[k]}>
            <span className={`lr-dot lr-lv-${k}`} />{LEVELS[k].label} {data.counts[k]}
          </button>
        ))}
      </div>

      <div className="lr-concepts">
        {rows.map(c => (
          <div key={c.concept} className={`lr-concept lr-concept--${c.level}`}>
            <div className="lr-concept-top">
              <span className={`lr-dot lr-lv-${c.level}`} />
              <strong className="lr-concept-name">{c.concept}</strong>
              <span className="lr-concept-lv">{LEVELS[c.level].label}</span>
            </div>
            <div className="lr-concept-meta">
              {c.attempts > 0 ? <>정답률 {Math.round(c.score * 100)}% · {c.attempts}번 풀이</> : "아직 문제를 안 풀어봤어요"}
              {c.wrongs > 0 && <> · 오답 {c.wrongs}</>}
              {c.cards_due > 0 && <> · 복습할 카드 {c.cards_due}</>}
            </div>
            <div className="lr-concept-actions">
              {onQuiz && <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => act("quiz", c)}>{busy === `quiz:${c.concept}` ? "만드는 중…" : "이 개념 퀴즈"}</button>}
              {onCards && <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => act("cards", c)}>{busy === `cards:${c.concept}` ? "만드는 중…" : "카드 만들기"}</button>}
              {c.level !== "good" && <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => act("plan", c)}>플래너에 넣기</button>}
            </div>
          </div>
        ))}
      </div>
      <p className="lr-muted lr-foot">
        최근에 푼 결과일수록 크게 반영해요 (퀴즈·플래시카드·그룹 문제). 80% 이상이면 ‘잘 앎’, 50% 미만이면 ‘모름’.
        {!data.has_summary && " 요약을 만들면 개념 목록이 더 정확해져요."}
      </p>
      <p className="lr-sr" aria-live="polite">{`개념 ${total}개 중 모름 ${data.counts.weak}개`}</p>
    </div>
  );
}
