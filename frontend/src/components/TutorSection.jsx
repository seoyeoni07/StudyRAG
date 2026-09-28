import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiFetch } from "../api";

const STARTERS = [
  "이 자료의 핵심 개념을 가르쳐주세요",
  "가장 중요한 내용이 뭔지 모르겠어요",
  "처음부터 차근차근 설명해주세요",
];

export default function TutorSection({ docId }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  async function send(message) {
    if (!message.trim() || loading) return;
    const userTurn = { role: "user", content: message };
    const next = [...history, userTurn];
    setHistory(next);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/tutor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, history, message }),
      });
      setHistory([...next, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err.message);
      setHistory(history); // rollback optimistic user bubble
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="tutor-wrap">
      {history.length === 0 && !loading && (
        <div className="tutor-empty">
          <p className="tutor-empty-title">AI 튜터와 함께 학습하세요</p>
          <p className="tutor-empty-sub">단순히 답을 알려주는 게 아니라, 이해할 때까지 함께 가르쳐드려요.</p>
          <div className="tutor-starters">
            {STARTERS.map(s => (
              <button key={s} className="example-chip" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="tutor-messages">
        {history.map((turn, i) => (
          <div key={i} className={`tutor-bubble tutor-bubble--${turn.role}`}>
            {turn.role === "assistant" ? (
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {turn.content}
              </ReactMarkdown>
            ) : (
              <span>{turn.content}</span>
            )}
          </div>
        ))}
        {loading && (
          <div className="tutor-bubble tutor-bubble--assistant tutor-bubble--loading">
            <span className="tutor-dots"><span /><span /><span /></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="tutor-form">
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="궁금한 점이나 이해 안 되는 내용을 말해보세요"
          disabled={loading}
        />
        <button type="submit" className="btn-primary" disabled={loading || !input.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
