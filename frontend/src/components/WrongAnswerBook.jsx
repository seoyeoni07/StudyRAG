import { useEffect, useState } from "react";
import { apiFetch } from "../api";

const FILTERS = [["all", "전체"], ["pending", "미복습"], ["today", "오늘 복습"]];

export default function WrongAnswerBook({ docId, onCountLoaded, onGoToQuiz }) {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("wrong");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [expandedSession, setExpandedSession] = useState(null);
  const [sessionDetail, setSessionDetail] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch(`/quiz/wrong-answers?doc_id=${docId}`),
      apiFetch(`/quiz/history?doc_id=${docId}`),
    ])
      .then(([w, h]) => { setItems(w); setHistory(h); onCountLoaded?.(w.length); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [docId]);

  async function toggleReviewed(item) {
    try {
      const data = await apiFetch(`/quiz/wrong-answers/${item.id}/reviewed`, { method: "PATCH" });
      setItems(prev => prev.map(it =>
        it.id === item.id ? { ...it, reviewed: data.reviewed, next_review: data.next_review } : it
      ));
    } catch (err) { setError(err.message); }
  }

  function filteredItems() {
    const today = new Date().toISOString().split("T")[0];
    let result = items;
    if (filter === "pending") result = result.filter(it => !it.reviewed);
    else if (filter === "today") result = result.filter(it => it.next_review && it.next_review.startsWith(today));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(it =>
        it.question.toLowerCase().includes(q) ||
        it.correct_answer.toLowerCase().includes(q)
      );
    }
    return result;
  }

  async function toggleSession(session_id) {
    if (expandedSession === session_id) {
      setExpandedSession(null);
      return;
    }
    setExpandedSession(session_id);
    if (sessionDetail[session_id]) return;
    setDetailLoading(true);
    try {
      const data = await apiFetch(`/quiz/history/${session_id}`);
      setSessionDetail(prev => ({ ...prev, [session_id]: data }));
    } catch {
      setSessionDetail(prev => ({ ...prev, [session_id]: [] }));
    } finally {
      setDetailLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <span className="loading-text">불러오는 중...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <div className="sub-tabs">
          <button
            className={view === "wrong" ? "btn-primary" : "btn-secondary"}
            onClick={() => setView("wrong")}
          >
            오답노트 ({items.length})
          </button>
          <button
            className={view === "history" ? "btn-primary" : "btn-secondary"}
            onClick={() => setView("history")}
          >
            학습 이력 ({history.length})
          </button>
        </div>
        {view === "wrong" && items.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {FILTERS.map(([k, l]) => (
              <button key={k} className={filter === k ? "btn-primary" : "btn-secondary"}
                style={{ padding: "4px 10px", fontSize: 13 }}
                onClick={() => setFilter(k)}>{l}</button>
            ))}
            <input className="input wrong-search" placeholder="키워드 검색…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 13, padding: "4px 10px", width: 160 }} />
          </div>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {view === "wrong" && onGoToQuiz && items.length > 0 && (
        <div style={{ textAlign: "right", marginBottom: 4 }}>
          <button className="btn-secondary" style={{ fontSize: 12, padding: "3px 12px" }} onClick={onGoToQuiz}>
            퀴즈 다시 풀기 →
          </button>
        </div>
      )}

      {view === "wrong" && (() => {
        const visible = filteredItems();
        return visible.length === 0
          ? <p className="empty">{items.length === 0 ? "아직 오답이 없습니다. 퀴즈를 풀어보세요!" : "해당 필터에 해당하는 항목이 없습니다."}</p>
          : visible.map((item) => (
            <div key={item.id} className={`wrong-item ${item.reviewed ? "wrong-item--reviewed" : ""}`}>
              <div className="wrong-item-header">
                <p className="q-text" style={{ margin: 0 }}><strong>Q.</strong> {item.question}</p>
                <button
                  className={`reviewed-btn ${item.reviewed ? "reviewed-btn--done" : ""}`}
                  onClick={() => toggleReviewed(item)}
                  title={item.reviewed ? "복습 완료 취소" : "복습 완료로 표시"}
                >
                  {item.reviewed ? "✓ 복습 완료" : "복습 전"}
                </button>
              </div>
              <p className="wrong-ans">내 답변: {item.user_answer || "(미입력)"}</p>
              <p className="correct-ans">정답: {item.correct_answer}</p>
              <p className="explanation">{item.explanation}</p>
              {item.reviewed && item.next_review && (
                <p className="next-review">
                  다음 복습일: {new Date(item.next_review).toLocaleDateString("ko-KR")}
                </p>
              )}
            </div>
          ));
      })()}

      {view === "history" && (
        history.length === 0
          ? <p className="empty">퀴즈 기록이 없습니다.</p>
          : history.map((h) => {
            const cls = h.score_pct >= 80 ? "good" : h.score_pct >= 50 ? "mid" : "low";
            const isOpen = expandedSession === h.session_id;
            const detail = sessionDetail[h.session_id];
            return (
              <div key={h.session_id}>
                <button className="history-row" onClick={() => toggleSession(h.session_id)}>
                  <span>{new Date(h.created_at).toLocaleString("ko-KR")}</span>
                  <span>{h.correct}/{h.total}문제</span>
                  <span className={`score-badge ${cls}`}>{h.score_pct}%</span>
                  <span className="history-chevron">{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="history-detail">
                    {detailLoading && !detail ? (
                      <div className="loading-wrap" style={{ padding: "16px 0" }}>
                        <div className="spinner spinner-sm" />
                      </div>
                    ) : (detail || []).map(r => (
                      <div key={r.id} className={`result-item ${r.correct ? "correct" : "wrong"}`}>
                        <span className={`result-badge ${r.correct ? "badge-correct" : "badge-wrong"}`}>
                          {r.correct ? "✓ 정답" : "✗ 오답"}
                        </span>
                        <p className="q-text">{r.question}</p>
                        {!r.correct && (
                          <>
                            {r.user_answer && <p>내 답변: <strong>{r.user_answer}</strong></p>}
                            <p className="correct-ans">정답: {r.correct_answer}</p>
                          </>
                        )}
                        <p className="explanation">{r.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
      )}
    </div>
  );
}
