import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiFetch } from "../api";

const EXAMPLES = [
  "이 강의의 핵심 개념을 요약해주세요",
  "중요한 용어와 정의를 정리해주세요",
  "가장 자주 출제되는 내용은 무엇인가요?",
];

function FeedbackRow({ docId, question }) {
  const [sent, setSent] = useState(null);
  async function send(helpful) {
    setSent(helpful);
    await apiFetch("/qa/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, question, helpful }),
    }).catch(() => {});
  }
  if (sent !== null) return <span className="feedback-thanks">피드백 감사합니다</span>;
  return (
    <span className="feedback-row">
      <span className="feedback-label">도움이 됐나요?</span>
      <button className="feedback-btn" onClick={() => send(true)}>👍</button>
      <button className="feedback-btn" onClick={() => send(false)}>👎</button>
    </span>
  );
}

export default function QASection({ docId }) {
  const [threads, setThreads] = useState([]); // [{question, answer, sources}]
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threads, loading]);

  async function ask(q) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError("");
    setInput("");
    try {
      const data = await apiFetch("/qa/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, question: q }),
      });
      setThreads(prev => [...prev, { question: q, answer: data.answer, sources: data.sources }]);
    } catch (err) {
      setError(err.message);
      setInput(q); // restore so user can retry
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    ask(input);
  }

  return (
    <div className="qa-wrap">
      {/* Empty state */}
      {threads.length === 0 && !loading && (
        <div className="qa-empty">
          <p className="qa-empty-label">예시 질문</p>
          <div className="qa-chips">
            {EXAMPLES.map(q => (
              <button key={q} className="example-chip" onClick={() => ask(q)}>{q}</button>
            ))}
          </div>
        </div>
      )}

      {/* Conversation threads */}
      <div className="qa-threads">
        {threads.map((t, i) => (
          <div key={i} className="qa-thread">
            {/* User bubble */}
            <div className="qa-bubble qa-bubble--user">
              <span>{t.question}</span>
            </div>

            {/* Answer bubble */}
            <div className="qa-bubble qa-bubble--ai">
              <div className="answer-text">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {t.answer}
                </ReactMarkdown>
              </div>
              {t.sources?.length > 0 && (
                <details className="sources">
                  <summary>참조 구간 보기 ({t.sources.length})</summary>
                  {t.sources.map((s, j) => {
                    const text = typeof s === "string" ? s : s.text;
                    const page = typeof s === "object" && s.page != null ? s.page : null;
                    return (
                      <blockquote key={j} className="source-item">
                        {page != null && <span className="source-page">p.{page}</span>}
                        {text}
                      </blockquote>
                    );
                  })}
                </details>
              )}
              <FeedbackRow docId={docId} question={t.question} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="qa-bubble qa-bubble--ai qa-bubble--loading">
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
          ref={inputRef}
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={threads.length === 0 ? "강의 내용에 대해 무엇이든 질문하세요" : "추가 질문을 입력하세요"}
          disabled={loading}
        />
        <button type="submit" className="btn-primary" disabled={loading || !input.trim()}>
          질문
        </button>
      </form>
    </div>
  );
}
