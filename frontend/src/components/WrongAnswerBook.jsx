import { useEffect, useState } from "react";
import { apiFetch } from "../api";

export default function WrongAnswerBook({ docId }) {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("wrong");
  const [error, setError] = useState("");
  const [expandedSession, setExpandedSession] = useState(null);
  const [sessionDetail, setSessionDetail] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch(`/quiz/wrong-answers?doc_id=${docId}`),
      apiFetch(`/quiz/history?doc_id=${docId}`),
    ])
      .then(([w, h]) => { setItems(w); setHistory(h); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [docId]);

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
          <button className="btn-secondary" onClick={() => window.print()}>PDF 저장</button>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {view === "wrong" && (
        items.length === 0
          ? <p className="empty">아직 오답이 없습니다. 퀴즈를 풀어보세요!</p>
          : items.map((item) => (
            <div key={item.id} className="wrong-item">
              <p className="q-text"><strong>Q.</strong> {item.question}</p>
              <p className="wrong-ans">내 답변: {item.user_answer || "(미입력)"}</p>
              <p className="correct-ans">정답: {item.correct_answer}</p>
              <p className="explanation">{item.explanation}</p>
            </div>
          ))
      )}

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
