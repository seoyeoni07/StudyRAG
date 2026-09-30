import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";

export default function DashboardHome({ onFileAccepted, onSelectDoc, onDeleteDoc, pastDocs, uploading, onPastDocsChange, onSelectDocTab }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);  // 선택한 문서의 이력
  const [editingFolder, setEditingFolder] = useState(null); // doc_id
  const [folderInput, setFolderInput] = useState("");
  const folderRef = useRef(null);

  useEffect(() => {
    apiFetch("/documents/dashboard").then(setStats).catch(() => {});
  }, [pastDocs.length]);

  useEffect(() => {
    if (editingFolder && folderRef.current) folderRef.current.focus();
  }, [editingFolder]);

  function handleFile(e) {
    if (e.target.files?.[0]) onFileAccepted([e.target.files[0]]);
  }

  async function openHistory(doc) {
    setHistory(null);
    const data = await apiFetch(`/documents/${doc.doc_id}/history`).catch(() => null);
    if (data) setHistory(data);
  }

  async function saveFolder(doc_id) {
    const folder = folderInput.trim() || null;
    await apiFetch(`/documents/${doc_id}/folder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    }).catch(() => {});
    setEditingFolder(null);
    onPastDocsChange();  // 목록 새로고침
  }

  const pct = (s, t) => t ? Math.round(s / t * 100) : 0;

  // 폴더별 그룹핑
  const grouped = pastDocs.reduce((acc, d) => {
    const key = d.folder || "미분류";
    (acc[key] = acc[key] || []).push(d);
    return acc;
  }, {});
  const folderOrder = Object.keys(grouped).sort((a, b) => a === "미분류" ? 1 : b === "미분류" ? -1 : a.localeCompare(b));

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

      {/* 오늘 복습 */}
      {stats?.today_docs?.length > 0 && (
        <div className="dash-section dash-review-section">
          <p className="dash-section-title">오늘 복습할 항목</p>
          <div className="dash-quiz-list">
            {stats.today_docs.map((d, i) => (
              <div key={i} className="dash-quiz-row dash-review-row"
                onClick={() => onSelectDocTab(d.doc_id, d.filename, "wrong")}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onSelectDocTab(d.doc_id, d.filename, "wrong")}>
                <span className="dash-quiz-name" title={d.filename}>{d.filename}</span>
                <span className="dash-review-count">{d.count}개 복습 대기</span>
                <span className="dash-review-go">→ 지금 복습</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* 내 자료 */}
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
          <div className="dash-folders">
            {folderOrder.map(folder => (
              <div key={folder} className="dash-folder-group">
                <p className="dash-folder-name">
                  <span className="dash-folder-icon">📁</span> {folder}
                  <span className="dash-folder-count">{grouped[folder].length}</span>
                </p>
                <div className="past-docs-list">
                  {grouped[folder].map(d => (
                    <div key={d.doc_id} className="past-doc-item past-doc-item--rich">
                      <button className="past-doc-main" onClick={() => onSelectDoc(d.doc_id, d.filename)}>
                        <span className="past-doc-name" title={d.filename}>{d.filename}</span>
                        <span className="past-doc-date">{new Date(d.created_at).toLocaleDateString("ko-KR")}</span>
                      </button>
                      <div className="past-doc-actions">
                        <button className="doc-action-btn" title="분석 이력"
                          onClick={() => history?.doc_id === d.doc_id ? setHistory(null) : openHistory(d)}>
                          이력
                        </button>
                        <button className="doc-action-btn" title="폴더 변경"
                          onClick={() => { setEditingFolder(d.doc_id); setFolderInput(d.folder || ""); }}>
                          폴더
                        </button>
                        <button className="past-doc-del" onClick={() => onDeleteDoc(d.doc_id)} title="삭제">×</button>
                      </div>

                      {/* 폴더 편집 인라인 */}
                      {editingFolder === d.doc_id && (
                        <div className="folder-edit-row">
                          <input ref={folderRef} className="input folder-input" placeholder="폴더명 (비우면 미분류)"
                            value={folderInput} onChange={e => setFolderInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveFolder(d.doc_id); if (e.key === "Escape") setEditingFolder(null); }} />
                          <button className="btn-primary" style={{ padding: "4px 12px", fontSize: 13 }} onClick={() => saveFolder(d.doc_id)}>저장</button>
                          <button className="btn-secondary" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setEditingFolder(null)}>취소</button>
                        </div>
                      )}

                      {/* 분석 이력 패널 */}
                      {history?.doc_id === d.doc_id && (
                        <div className="doc-history-panel">
                          <div className="doc-history-stats">
                            <span className="doc-hist-badge">{history.chunks}개 청크</span>
                            {history.has_summary && <span className="doc-hist-badge doc-hist-badge--green">요약 있음</span>}
                            <span className="doc-hist-badge">오답 {history.total_wrongs}개</span>
                            {history.today_review > 0 && <span className="doc-hist-badge doc-hist-badge--amber">오늘 복습 {history.today_review}개</span>}
                          </div>
                          {history.quizzes.length === 0 ? (
                            <p className="doc-history-empty">아직 퀴즈 기록이 없어요.</p>
                          ) : (
                            <div className="doc-history-quizzes">
                              <p className="doc-history-label">퀴즈 이력</p>
                              {history.quizzes.map((q, i) => (
                                <div key={i} className="doc-hist-quiz-row">
                                  <span className="doc-hist-date">{new Date(q.date).toLocaleDateString("ko-KR")}</span>
                                  <div className="doc-hist-bar-wrap">
                                    <div className="doc-hist-bar" style={{ width: `${pct(q.score, q.total)}%`,
                                      background: pct(q.score, q.total) >= 80 ? "var(--primary)" : pct(q.score, q.total) >= 50 ? "var(--amber)" : "var(--red)" }} />
                                  </div>
                                  <span className={`dash-quiz-score ${pct(q.score, q.total) >= 80 ? "score--high" : pct(q.score, q.total) >= 50 ? "score--mid" : "score--low"}`}>
                                    {q.score}/{q.total}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
