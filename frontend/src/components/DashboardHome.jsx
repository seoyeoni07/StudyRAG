import { useState, useEffect } from "react";
import { apiFetch } from "../api";

export default function DashboardHome({ onFileAccepted, onSelectDoc, onDeleteDoc, pastDocs, uploading }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    apiFetch("/documents/dashboard").then(setStats).catch(() => {});
  }, [pastDocs.length]);

  function handleFile(e) {
    if (e.target.files?.[0]) onFileAccepted([e.target.files[0]]);
  }

  const pct = (score, total) => total ? Math.round(score / total * 100) : 0;

  return (
    <div className="dashboard-wrap">
      {/* 통계 카드 */}
      <div className="dash-stats">
        <div className="dash-stat-card dash-stat--review">
          <span className="dash-stat-value">{stats?.today_review ?? "—"}</span>
          <span className="dash-stat-label">오늘 복습</span>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-value">{stats?.total_wrongs ?? "—"}</span>
          <span className="dash-stat-label">전체 오답</span>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-value">{stats?.total_docs ?? "—"}</span>
          <span className="dash-stat-label">자료</span>
        </div>
      </div>

      {/* 최근 퀴즈 */}
      {stats?.recent_quizzes?.length > 0 && (
        <div className="dash-section">
          <p className="dash-section-title">최근 퀴즈</p>
          <div className="dash-quiz-list">
            {stats.recent_quizzes.map((q, i) => (
              <div key={i} className="dash-quiz-row"
                onClick={() => onSelectDoc(q.doc_id, q.doc_name)}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onSelectDoc(q.doc_id, q.doc_name)}>
                <span className="dash-quiz-name" title={q.doc_name}>{q.doc_name}</span>
                <span className={`dash-quiz-score ${pct(q.score, q.total) >= 80 ? "score--high" : pct(q.score, q.total) >= 50 ? "score--mid" : "score--low"}`}>
                  {q.score}/{q.total} ({pct(q.score, q.total)}%)
                </span>
                <span className="dash-quiz-date">{new Date(q.date).toLocaleDateString("ko-KR")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 자료 목록 + 업로드 */}
      <div className="dash-section">
        <div className="dash-section-header">
          <p className="dash-section-title">내 자료</p>
          <label className="btn-primary dash-upload-btn">
            <input type="file" accept=".pdf" hidden disabled={uploading} onChange={handleFile} />
            {uploading ? "분석 중…" : "+ 자료 추가"}
          </label>
        </div>

        {pastDocs.length === 0 ? (
          <label className="dash-empty-upload">
            <input type="file" accept=".pdf" hidden disabled={uploading} onChange={handleFile} />
            <p className="upload-heading">{uploading ? "분석 중…" : "강의자료 PDF 업로드"}</p>
            <p className="upload-sub">파일을 클릭해서 선택하거나 이 영역에 드래그하세요.</p>
            {!uploading && <span className="upload-btn">파일 선택</span>}
          </label>
        ) : (
          <div className="past-docs-list">
            {pastDocs.map(d => (
              <div key={d.doc_id} className="past-doc-item">
                <button className="past-doc-main" onClick={() => onSelectDoc(d.doc_id, d.filename)}>
                  <span className="past-doc-name" title={d.filename}>{d.filename}</span>
                  <span className="past-doc-date">{new Date(d.created_at).toLocaleDateString("ko-KR")}</span>
                </button>
                <button className="past-doc-del" onClick={() => onDeleteDoc(d.doc_id)} title="삭제">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
