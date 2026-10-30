import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiFetch } from "../api";

const Md = ({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
    {children || ""}
  </ReactMarkdown>
);

const LOADING_STEPS = [
  "강의자료 분석 중...",
  "핵심 개념 추출 중...",
  "문제 생성 중...",
  "난이도 조정 중...",
  "마무리 중...",
];

export default function QuizSection({ docId, onGoToWrong, initialSession, onClearInitial }) {
  const [n, setN] = useState(5);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const stepTimerRef = useRef(null);
  const [grading, setGrading] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());
  const [adaptive, setAdaptive] = useState(false);
  // -1 = 결과 요약, 0..n-1 = 해당 문제
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    if (initialSession) {
      setQuestions(initialSession.questions);
      setSessionId(initialSession.session_id);
      setAnswers({});
      setResults(null);
      setError("");
      setReportedIds(new Set());
      setCurrentIdx(0);
      onClearInitial?.();
    }
  }, [initialSession]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    setLoading(true);
    setLoadingStep(0);
    setError("");
    setResults(null);
    setAnswers({});
    setCurrentIdx(0);
    let step = 0;
    stepTimerRef.current = setInterval(() => {
      step = Math.min(step + 1, LOADING_STEPS.length - 1);
      setLoadingStep(step);
    }, 3500);
    try {
      let focus_difficulty = null;
      if (adaptive) {
        try {
          const weak = await apiFetch(`/quiz/weak-difficulty?doc_id=${docId}`);
          focus_difficulty = weak.focus_difficulty;
        } catch {}
      }
      const data = await apiFetch("/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, n, focus_difficulty }),
      });
      setQuestions(data.questions);
      setSessionId(data.session_id);
    } catch (err) {
      setError(err.message);
    } finally {
      clearInterval(stepTimerRef.current);
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
      setCurrentIdx(-1); // 결과 요약 화면으로
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
    setReportedIds(new Set());
    setCurrentIdx(0);
  }

  async function handleReport(question) {
    try {
      await apiFetch("/quiz/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, question, issue: "오류 신고" }),
      });
      setReportedIds(prev => new Set([...prev, question]));
    } catch {}
  }

  const ErrorBox = ({ msg }) => msg ? (
    <div className="error-banner">
      <span className="error-icon">⚠️</span>
      <span>{msg}</span>
    </div>
  ) : null;

  // ── 로딩 ──
  if (loading) {
    return (
      <div className="loading-wrap" style={{ flexDirection: "column", gap: "16px", padding: "40px 0" }}>
        <div className="spinner" style={{ width: "36px", height: "36px" }} />
        <span className="loading-text" style={{ fontSize: "15px", fontWeight: "600" }}>
          {LOADING_STEPS[loadingStep]}
        </span>
        <div className="quiz-step-dots">
          {LOADING_STEPS.map((_, i) => (
            <span key={i} className={`quiz-step-dot ${i <= loadingStep ? "active" : ""}`} />
          ))}
        </div>
        <span style={{ fontSize: "12px", color: "var(--text-4)" }}>보통 10~20초 걸려요</span>
      </div>
    );
  }

  // ── 채점 중 ──
  if (grading) {
    return (
      <div className="loading-wrap" style={{ flexDirection: "column", gap: "12px", padding: "40px 0" }}>
        <div className="spinner" style={{ width: "32px", height: "32px" }} />
        <span style={{ fontSize: "14px", color: "var(--text-3)" }}>채점 중...</span>
      </div>
    );
  }

  // ── 설정 화면 ──
  if (!questions.length) {
    return (
      <div>
        <ErrorBox msg={error} />
        <div className="generate-form">
          <span className="generate-label">문제 수</span>
          <div className="n-btn-group">
            {[3, 5, 7, 10].map(v => (
              <button key={v} className={n === v ? "btn-primary" : "btn-secondary"}
                style={{ padding: "4px 14px" }} onClick={() => setN(v)}>{v}문제</button>
            ))}
          </div>
          <button className="btn-primary" onClick={handleGenerate}>퀴즈 생성</button>
        </div>
        <label className="adaptive-toggle">
          <input type="checkbox" checked={adaptive} onChange={(e) => setAdaptive(e.target.checked)} />
          <span>취약 유형 집중 (적응형)</span>
        </label>
      </div>
    );
  }

  // ── 결과 요약 ──
  if (results && currentIdx === -1) {
    const pct = Math.round((results.score / results.total) * 100);
    const wrongCount = results.total - results.score;
    const scoreClass = pct >= 80 ? "good" : pct >= 50 ? "mid" : "low";
    const scoreMsg = pct >= 80 ? "훌륭해요!" : pct >= 50 ? "절반 이상 맞혔어요" : "복습이 필요해요";
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
        {wrongCount > 0 && (
          <div className="wrong-saved">
            오답 {wrongCount}개가 오답노트에 저장되었습니다.
            {onGoToWrong && (
              <button className="btn-secondary" style={{ marginLeft: 12, fontSize: 13, padding: "3px 12px" }}
                onClick={onGoToWrong}>오답노트 보기 →</button>
            )}
          </div>
        )}
        <div className="quiz-nav-row">
          <button className="btn-secondary" onClick={reset}>다시 풀기</button>
          <button className="btn-primary" onClick={() => setCurrentIdx(0)}>문제별 결과 보기</button>
        </div>
      </div>
    );
  }

  // ── 문제별 결과 리뷰 ──
  if (results && currentIdx >= 0) {
    const r = results.results[currentIdx];
    const q = questions.find(q => q.id === r.id);
    const reported = reportedIds.has(q?.question);
    const isLast = currentIdx === results.results.length - 1;
    const correctLetter = r.correct_answer?.[0];

    return (
      <div>
        <div className="quiz-progress">문제 {currentIdx + 1} / {results.total}</div>
        <div className="q-text" style={{ margin: "12px 0 20px" }}><Md>{q?.question}</Md></div>

        {q?.type === "multiple_choice" && (
          <div className="quiz-options">
            {q.options.map(opt => {
              const letter = opt[0];
              const isUserPick = r.user_answer === letter;
              const isCorrectCard = correctLetter && letter === correctLetter;
              let cls = "quiz-opt-card";
              if (isCorrectCard) cls += " quiz-opt-card--correct";
              else if (isUserPick && !r.correct) cls += " quiz-opt-card--wrong";
              return <div key={opt} className={cls}>{opt}</div>;
            })}
          </div>
        )}

        {q?.type !== "multiple_choice" && (
          <div className="quiz-feedback-answer">
            내 답변: <strong>{r.user_answer || "(미입력)"}</strong>
            {!r.correct && <> · 정답: <strong>{r.correct_answer}</strong></>}
          </div>
        )}

        <div className="quiz-feedback-row">
          <span className={`quiz-feedback-badge ${r.correct ? "quiz-feedback-badge--correct" : "quiz-feedback-badge--wrong"}`}>
            {r.correct ? "정답" : "오답"}
          </span>
          {r.explanation && <span className="quiz-feedback-text"><Md>{r.explanation}</Md></span>}
        </div>

        <div className="quiz-nav-row">
          <button className="btn-secondary" disabled={currentIdx === 0}
            onClick={() => setCurrentIdx(i => i - 1)}>이전</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={`report-btn ${reported ? "report-btn--done" : ""}`}
              onClick={() => !reported && handleReport(q?.question)}
              disabled={reported}
            >{reported ? "신고됨" : "오류 신고"}</button>
            {isLast ? (
              <button className="btn-secondary" onClick={reset}>다시 풀기</button>
            ) : (
              <button className="btn-primary" onClick={() => setCurrentIdx(i => i + 1)}>다음</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 문제 풀기 (한 문제씩) ──
  const q = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const selected = answers[q.id];

  return (
    <div>
      <div className="quiz-progress">
        문제 {currentIdx + 1} / {questions.length}
        {q.difficulty && (
          <span className={`diff-badge diff-${q.difficulty === "기본" ? "easy" : q.difficulty === "응용" ? "mid" : "hard"}`}
            style={{ marginLeft: 8 }}>
            {q.difficulty}
          </span>
        )}
      </div>

      <div className="q-text" style={{ margin: "12px 0 20px" }}><Md>{q.question}</Md></div>

      <ErrorBox msg={error} />

      {q.type === "multiple_choice" ? (
        <div className="quiz-options">
          {q.options.map(opt => {
            const letter = opt[0];
            return (
              <div key={opt}
                className={`quiz-opt-card${selected === letter ? " quiz-opt-card--selected" : ""}`}
                onClick={() => setAnswers(prev => ({ ...prev, [q.id]: letter }))}
              >{opt}</div>
            );
          })}
        </div>
      ) : (
        <input
          type="text"
          placeholder="답변을 입력하세요"
          value={answers[q.id] || ""}
          onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
          className="input"
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="quiz-nav-row">
        <button className="btn-secondary" disabled={currentIdx === 0}
          onClick={() => setCurrentIdx(i => i - 1)}>이전</button>
        {isLast ? (
          <button className="btn-primary" onClick={handleGrade}>제출하기</button>
        ) : (
          <button className="btn-primary" onClick={() => setCurrentIdx(i => i + 1)}>다음</button>
        )}
      </div>
    </div>
  );
}
