import { useState, useEffect } from "react";
import { apiFetch } from "../api";

export default function SummarySection({ docId, onSaveNote }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSummary(null);
    setError("");
    load();
  }, [docId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch(`/documents/${docId}/summary`);
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap" style={{ flexDirection: "column", gap: 14, padding: "40px 0" }}>
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <span className="loading-text" style={{ fontSize: 15, fontWeight: 600 }}>
          AI가 강의 전체를 분석 중입니다...
        </span>
        <span style={{ fontSize: 12, color: "var(--text-4)" }}>보통 15~30초 걸려요</span>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="summary-empty">
        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            <span className="error-icon">⚠️</span><span>{error}</span>
          </div>
        )}
        <p className="empty" style={{ marginBottom: 20 }}>
          강의자료 전체를 AI가 분석해 핵심만 정리해드립니다.
        </p>
        <button className="btn-primary" onClick={load}>강의 요약 생성</button>
      </div>
    );
  }

  return (
    <div className="summary-wrap">
      <div className="summary-overview">
        <h3 className="summary-title">강의 개요</h3>
        <p className="summary-text">{summary.overview}</p>
      </div>

      <div className="summary-section">
        <h4 className="summary-subtitle">핵심 개념</h4>
        <ol className="summary-concepts">
          {(summary.key_concepts || []).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
      </div>

      <div className="summary-section">
        <h4 className="summary-subtitle">키워드</h4>
        <div className="summary-keywords">
          {(summary.keywords || []).map((k, i) => (
            <span key={i} className="keyword-chip">{k}</span>
          ))}
        </div>
      </div>

      {summary.study_tip && (
        <div className="summary-tip">
          <span className="summary-tip-icon">💡</span>
          <span>{summary.study_tip}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {onSaveNote && (
          <button className="btn-secondary" onClick={() => onSaveNote("강의 요약", [
            "## 강의 개요", summary.overview || "",
            "", "## 핵심 개념", ...(summary.key_concepts || []).map((c, i) => `${i + 1}. ${c}`),
            "", "## 키워드", (summary.keywords || []).map(k => `\`${k}\``).join(" "),
            ...(summary.study_tip ? ["", `> 💡 ${summary.study_tip}`] : []),
          ].join("\n"))}>
            노트로 저장
          </button>
        )}
        <button className="btn-secondary" onClick={() => setSummary(null)}>
          다시 생성
        </button>
      </div>
    </div>
  );
}
