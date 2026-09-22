import { useState } from "react";
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

export default function QASection({ docId }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAsk(e) {
    e?.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError("");
    setAnswer(null);
    try {
      const data = await apiFetch("/qa/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, question }),
      });
      setAnswer(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleExample(q) {
    setQuestion(q);
    // auto-submit
    setLoading(true);
    setError("");
    setAnswer(null);
    apiFetch("/qa/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, question: q }),
    })
      .then(setAnswer)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  return (
    <div>
      <form onSubmit={handleAsk} className="qa-form">
        <input
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="강의 내용에 대해 무엇이든 질문하세요"
          disabled={loading}
        />
        <button type="submit" className="btn-primary" disabled={loading || !question.trim()}>
          {loading ? "⏳" : "질문"}
        </button>
      </form>

      {/* Example chips — shown only when no answer yet */}
      {!answer && !loading && (
        <div className="qa-examples">
          <span className="qa-examples-label">예시 질문</span>
          <div className="qa-chips">
            {EXAMPLES.map(q => (
              <button key={q} className="example-chip" onClick={() => handleExample(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="loading-wrap">
          <div className="spinner" />
          <span className="loading-text">답변 생성 중...</span>
        </div>
      )}

      {!loading && answer && (
        <div className="answer-box">
          <div className="answer-text">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {answer.answer}
            </ReactMarkdown>
          </div>
          {answer.sources?.length > 0 && (
            <details className="sources">
              <summary>참조 구간 보기 ({answer.sources.length})</summary>
              {answer.sources.map((s, i) => (
                <blockquote key={i} className="source-item">{s}</blockquote>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
