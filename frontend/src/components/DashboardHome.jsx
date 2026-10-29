import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";

export default function DashboardHome({ onFileAccepted, onSelectDoc, onDeleteDoc, pastDocs, uploading, onPastDocsChange, onSelectDocTab, notesSlot, reviewDue = 0, onAskMulti, onOpenPlanner }) {
  const [stats, setStats] = useState(null);
  const [planner, setPlanner] = useState(null);
  const [history, setHistory] = useState(null);
  const [editingFolder, setEditingFolder] = useState(null);
  const [folderInput, setFolderInput] = useState("");
  const folderRef = useRef(null);
  const [multiOpen, setMultiOpen] = useState(false);
  const [multiSelected, setMultiSelected] = useState([]);
  const [multiQ, setMultiQ] = useState("");
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiAnswer, setMultiAnswer] = useState(null);

  useEffect(() => {
    if (multiOpen) setMultiSelected(pastDocs.map(d => d.doc_id));
  }, [multiOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiFetch("/documents/dashboard").then(setStats).catch(() => {});
    apiFetch("/planner/today-summary").then(setPlanner).catch(() => setPlanner({ tasks: [], goal: null, color_map: {} }));
  }, [pastDocs.length]);

  useEffect(() => {
    if (editingFolder && folderRef.current) folderRef.current.focus();
  }, [editingFolder]);

  function handleFile(e) {
    if (e.target.files?.[0]) onFileAccepted([e.target.files[0]]);
  }

  async function openHistory(doc) {
    setHistory(h => h?.doc_id === doc.doc_id ? null : null);
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
    onPastDocsChange();
  }

  async function runMultiSearch() {
    if (!multiSelected.length || !multiQ.trim()) return;
    setMultiLoading(true); setMultiAnswer(null);
    try {
      const res = await onAskMulti(multiSelected, multiQ.trim());
      setMultiAnswer(res);
    } catch (err) { setMultiAnswer({ answer: `오류: ${err.message}`, sources: [] }); }
    finally { setMultiLoading(false); }
  }

  const pct = (s, t) => t ? Math.round(s / t * 100) : 0;

  const grouped = pastDocs.reduce((acc, d) => {
    const key = d.folder || "미분류";
    (acc[key] = acc[key] || []).push(d);
    return acc;
  }, {});
  const folderOrder = Object.keys(grouped).sort((a, b) => a === "미분류" ? 1 : b === "미분류" ? -1 : a.localeCompare(b));

  return (
    <div className="dashboard-wrap">

      {/* ── 통계 타일 ── */}
      <div className="dash-stats">
        <div className="dash-stat-card">
          <span className="dash-stat-label">오늘 복습</span>
          <span className="dash-stat-value">{stats?.today_review ?? "—"}</span>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-label">전체 오답</span>
          <span className="dash-stat-value">{stats?.total_wrongs ?? "—"}</span>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-label">내 자료</span>
          <span className="dash-stat-value">{stats?.total_docs ?? pastDocs.length}</span>
        </div>
      </div>

      {/* ── 복습 알림 ── */}
      {reviewDue > 0 && (
        <div className="dash-review-alert">
          <div className="dash-review-alert-left">
            <span className="dash-review-alert-title">복습 대기</span>
            <span className="dash-review-alert-text">오답노트에 복습할 항목이 <strong>{reviewDue}개</strong> 있어요.</span>
          </div>
        </div>
      )}

      {/* ── 2열 본문 ── */}
      <div className="dash-body-grid">

        {/* 왼쪽: 내 자료 */}
        <div className="dash-body-main">
          <div className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-title">내 자료</span>
              <label className="btn-primary btn-sm" style={{ cursor: "pointer" }}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading} onChange={handleFile} />
                {uploading ? "분석 중…" : "+ 추가"}
              </label>
            </div>

            {pastDocs.length === 0 ? (
              <label className="dash-empty-upload">
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading} onChange={handleFile} />
                <p className="upload-heading">{uploading ? "분석 중…" : "강의자료 업로드"}</p>
                <p className="upload-sub">PDF 또는 이미지 파일을 선택하거나 드래그하세요.</p>
                {!uploading && <span className="upload-btn">파일 선택</span>}
              </label>
            ) : (
              <div className="dash-doc-table">
                {folderOrder.map(folder => (
                  <div key={folder}>
                    {folderOrder.length > 1 && (
                      <div className="dash-doc-folder-row">
                        <span className="dash-doc-folder-name">📁 {folder}</span>
                        <span className="dash-doc-folder-count">{grouped[folder].length}</span>
                      </div>
                    )}
                    {grouped[folder].map(d => (
                      <div key={d.doc_id} className="dash-doc-row">
                        <button className="dash-doc-main" onClick={() => onSelectDoc(d.doc_id, d.filename)}>
                          <span className="dash-doc-icon">📄</span>
                          <span className="dash-doc-name" title={d.filename}>{d.filename.replace(/\.pdf$/i, "")}</span>
                          {d.status === "processing" && <span className="dash-doc-status">처리 중</span>}
                        </button>
                        <span className="dash-doc-date">{new Date(d.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</span>
                        <div className="dash-doc-actions">
                          <button className="doc-action-btn" onClick={() => { setEditingFolder(d.doc_id); setFolderInput(d.folder || ""); }}>폴더</button>
                          <button className="doc-action-btn" onClick={() => openHistory(d)}>이력</button>
                          <button className="doc-action-btn doc-action-btn--del" onClick={() => onDeleteDoc(d.doc_id)}>×</button>
                        </div>

                        {editingFolder === d.doc_id && (
                          <div className="folder-edit-row">
                            <input ref={folderRef} className="input folder-input" placeholder="폴더명 (비우면 미분류)"
                              value={folderInput} onChange={e => setFolderInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") saveFolder(d.doc_id); if (e.key === "Escape") setEditingFolder(null); }} />
                            <button className="btn-primary btn-sm" onClick={() => saveFolder(d.doc_id)}>저장</button>
                            <button className="btn-secondary btn-sm" onClick={() => setEditingFolder(null)}>취소</button>
                          </div>
                        )}

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
                ))}
              </div>
            )}
          </div>

          {/* 다중 자료 검색 */}
          {pastDocs.length > 1 && (
            <div className="dash-panel" style={{ marginTop: 12 }}>
              <button className="dash-panel-head dash-panel-head--btn" onClick={() => setMultiOpen(o => !o)}>
                <span className="dash-panel-title">여러 자료 동시 검색</span>
                <span style={{ color: "var(--text-4)", fontSize: 12 }}>{multiOpen ? "▲" : "▼"}</span>
              </button>
              {multiOpen && (
                <div className="dash-multi-body">
                  <div className="dash-multi-docs">
                    {pastDocs.map(d => (
                      <label key={d.doc_id} className="dash-multi-doc-label">
                        <input type="checkbox" checked={multiSelected.includes(d.doc_id)}
                          onChange={e => setMultiSelected(prev =>
                            e.target.checked ? [...prev, d.doc_id] : prev.filter(id => id !== d.doc_id)
                          )} />
                        <span className="dash-multi-doc-name">{d.filename}</span>
                      </label>
                    ))}
                  </div>
                  <div className="dash-multi-input-row">
                    <input className="input dash-multi-input" placeholder="여러 자료에 걸쳐 질문하세요..." value={multiQ}
                      onChange={e => setMultiQ(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && runMultiSearch()} />
                    <button className="btn-primary btn-sm" onClick={runMultiSearch}
                      disabled={multiLoading || !multiSelected.length || !multiQ.trim()}>
                      {multiLoading ? "…" : "검색"}
                    </button>
                  </div>
                  {multiAnswer && (
                    <div className="dash-multi-answer">
                      <p className="dash-multi-answer-text">{multiAnswer.answer}</p>
                      {multiAnswer.sources?.length > 0 && (
                        <details className="dash-multi-sources">
                          <summary>참고 내용 {multiAnswer.sources.length}개</summary>
                          {multiAnswer.sources.map((s, i) => <div key={i} className="dash-multi-source-item">{s.text}</div>)}
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 오른쪽: 오늘 플래너 + 오늘 복습 + 최근 퀴즈 + 노트 */}
        <div className="dash-body-side">

          {/* 오늘 할 일 */}
          {planner && (() => {
            const done = planner.tasks.filter(t => t.done).length;
            const total = planner.tasks.length;
            const pctDone = total ? Math.round(done / total * 100) : 0;
            return (
              <div className="dash-panel">
                <div className="dash-panel-head">
                  <span className="dash-panel-title">오늘 할 일</span>
                  <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onOpenPlanner}>플래너 →</button>
                </div>
                {planner.goal && (
                  <div className="dash-planner-goal">{planner.goal}</div>
                )}
                {total > 0 ? (
                  <>
                    <div className="dash-planner-progress">
                      <div className="dash-planner-progress-bar" style={{ width: `${pctDone}%` }} />
                    </div>
                    <div className="dash-side-list">
                      {planner.tasks.map(t => (
                        <div key={t.id} className={`dash-planner-task${t.done ? " dash-planner-task--done" : ""}`}>
                          {t.subject && (
                            <span className="dash-planner-dot" style={{ background: planner.color_map[t.subject] || "#CBCBCB" }} />
                          )}
                          <span className="dash-planner-task-text">{t.title}</span>
                          {t.done && <span className="dash-planner-check">✓</span>}
                        </div>
                      ))}
                    </div>
                    <div className="dash-planner-footer">
                      <span>{done}/{total} 완료</span>
                      {pctDone === 100 && <span className="dash-planner-all-done">오늘 목표 달성!</span>}
                    </div>
                  </>
                ) : (
                  <button className="dash-planner-empty" onClick={onOpenPlanner}>
                    오늘 할 일을 추가해보세요
                  </button>
                )}
              </div>
            );
          })()}

          {/* 오늘 복습 */}
          {stats?.today_docs?.length > 0 && (
            <div className="dash-panel">
              <div className="dash-panel-head">
                <span className="dash-panel-title">오늘 복습</span>
              </div>
              <div className="dash-side-list">
                {stats.today_docs.map((d, i) => (
                  <button key={i} className="dash-side-row"
                    onClick={() => onSelectDocTab(d.doc_id, d.filename, "wrong")}>
                    <span className="dash-side-name">{d.filename.replace(/\.pdf$/i, "")}</span>
                    <span className="dash-side-badge">{d.count}개</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 최근 퀴즈 */}
          {stats?.recent_quizzes?.length > 0 && (
            <div className="dash-panel">
              <div className="dash-panel-head">
                <span className="dash-panel-title">최근 퀴즈</span>
              </div>
              <div className="dash-side-list">
                {stats.recent_quizzes.map((q, i) => (
                  <button key={i} className="dash-side-row"
                    onClick={() => onSelectDocTab(q.doc_id, q.doc_name, "quiz")}>
                    <span className="dash-side-name">{q.doc_name.replace(/\.pdf$/i, "")}</span>
                    <span className={`dash-quiz-score ${pct(q.score, q.total) >= 80 ? "score--high" : pct(q.score, q.total) >= 50 ? "score--mid" : "score--low"}`}>
                      {pct(q.score, q.total)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 최근 노트 */}
          {notesSlot}
        </div>
      </div>
    </div>
  );
}
