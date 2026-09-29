import { useState } from "react";
import { apiFetch } from "../api";

export default function QuizSection({ docId }) {
  const [n, setN] = useState(5);
  const [loading, setLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setLoading(true);
    setError("");
    setResults(null);
    setAnswers({});
    try {
      const data = await apiFetch("/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, n }),
      });
      setQuestions(data.questions);
      setSessionId(data.session_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGrade() {
    setGrading(true);
    setError("");
    try {
      const data = await apiFetch("/quiz/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          answers: Object.entries(answers).map(([id, answer]) => ({
            id: parseInt(id),
            answer: answer || "",
          })),
        }),
      });
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setGrading(false);
    }
  }

  function reset() {
    setQuestions([]);
    setSessionId(null);
    setAnswers({});
    setResults(null);
    setError("");
  }

  const ErrorBox = ({ msg }) => msg ? (
    <div className="error-banner">
      <span className="error-icon">⚠️</span>
      <span>{msg}</span>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <span className="loading-text">퀴즈 생성 중... (10~20초 소요)</span>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div>
        <ErrorBox msg={error} />
        <div className="generate-form">
          <span className="generate-label">문제 수</span>
          <input
            type="number"
            min={1}
            max={10}
            value={n}
            onChange={(e) => setN(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
            className="input number-input"
          />
          <button className="btn-primary" onClick={handleGenerate}>퀴즈 생성</button>
        </div>
      </div>
    );
  }

  if (results) {
    const pct = Math.round((results.score / results.total) * 100);
    const wrongCount = results.total - results.score;
    const scoreClass = pct >= 80 ? "good" : pct >= 50 ? "mid" : "low";
    const scoreMsg   = pct >= 80 ? "훌륭해요!" : pct >= 50 ? "절반 이상 맞혔어요" : "복습이 필요해요";
    return (
      <div>
        <div className={`score-header ${scoreClass}`}>
          <span className="score-big">{pct}%</span>
          <div className="score-meta">
            <span className="score-fraction">{results.score}/{results.total} 정답</span>
            <span className="score-label">{scoreMsg}</span>
          </div>
        </div>

        <ErrorBox msg={error} />

        {results.results.map((r) => {
          const q = questions.find((q) => q.id === r.id);
          return (
            <div key={r.id} className={`result-item ${r.correct ? "correct" : "wrong"}`}>
              <span className={`result-badge ${r.correct ? "badge-correct" : "badge-wrong"}`}>
                {r.correct ? "✓ 정답" : "✗ 오답"}
              </span>
              <p className="q-text">{q?.question}</p>
              <p>내 답변: <strong>{r.user_answer || "(미입력)"}</strong></p>
              {!r.correct && <p className="correct-ans">정답: {r.correct_answer}</p>}
              <p className="explanation">{r.explanation}</p>
            </div>
          );
        })}

        {wrongCount > 0 && (
          <div className="wrong-saved">
            📝 오답 {wrongCount}개가 오답노트에 저장되었습니다.
          </div>
        )}

        <button className="btn-secondary" onClick={reset}>다시 풀기</button>
      </div>
    );
  }

  return (
    <div>
      <p className="q-num" style={{ marginBottom: "16px" }}>{questions.length}문제</p>

      <ErrorBox msg={error} />

      {questions.map((q) => (
        <div key={q.id} className="question-item">
          <div className="q-num">
            문제 {q.id}
            {q.difficulty && (
              <span className={`diff-badge diff-${q.difficulty === "기본" ? "easy" : q.difficulty === "응용" ? "mid" : "hard"}`}>
                {q.difficulty}
              </span>
            )}
          </div>
          <p className="q-text">{q.question}</p>
          {q.type === "multiple_choice" ? (
            <div className="options">
              {q.options.map((opt) => {
                const letter = opt[0];
                return (
                  <label key={opt} className="option-label">
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      value={letter}
                      checked={answers[q.id] === letter}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: letter }))}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          ) : (
            <input
              type="text"
              placeholder="답변을 입력하세요"
              value={answers[q.id] || ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              className="input"
            />
          )}
        </div>
      ))}

      <div className="quiz-submit-row">
        <button className="btn-primary" onClick={handleGrade} disabled={grading}>
          {grading ? <><div className="spinner spinner-sm" /> 채점 중...</> : "제출하기"}
        </button>
      </div>
    </div>
  );
}
