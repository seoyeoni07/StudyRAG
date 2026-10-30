import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { NoteIcon, renderNoteIcon, UploadIcon } from "./Icons.jsx";

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  const d = Math.round(m / 1440);
  if (d < 30) return `${d}일 전`;
  return new Date(t).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function DashboardHome({
  onFileAccepted, onSelectDoc, onDeleteDoc, pastDocs, uploading,
  onPastDocsChange, onSelectDocTab, notesSlot, reviewDue = 0,
  onAskMulti, onOpenPlanner, streak = 0,
  notes = [], onOpenNote, onCreateNote,
}) {
  const [planner, setPlanner] = useState(null);
  const [q, setQ] = useState("");
  const fileRef = useRef();
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    apiFetch("/planner/today-summary")
      .then(setPlanner)
      .catch(() => setPlanner({ tasks: [], goal: null, color_map: {} }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (file) { onFileAccepted([file]); e.target.value = ""; }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileAccepted([file]);
  }

  const filteredDocs = q.trim()
    ? pastDocs.filter(d => d.filename.toLowerCase().includes(q.toLowerCase()))
    : pastDocs;

  const filteredNotes = q.trim()
    ? notes.filter(n => (n.title || "").toLowerCase().includes(q.toLowerCase()))
    : notes;

  const plannerDone = planner?.tasks.filter(t => t.done).length ?? 0;
  const plannerTotal = planner?.tasks.length ?? 0;

  const isEmpty = pastDocs.length === 0 && notes.length === 0;

  return (
    <div className="launcher-wrap">

      {/* ── 상단 상태 바 ── */}
      {(reviewDue > 0 || plannerTotal > 0) && (
        <div className="launcher-status-bar">
          {reviewDue > 0 && (
            <span className="launcher-status-pill launcher-status-pill--amber">
              오답노트 복습 {reviewDue}개 대기
            </span>
          )}
          {plannerTotal > 0 && (
            <button className="launcher-status-pill launcher-status-pill--planner" onClick={onOpenPlanner}>
              오늘 할 일 {plannerDone}/{plannerTotal}
              {plannerDone === plannerTotal && " ✓"}
            </button>
          )}
          {plannerTotal === 0 && (
            <button className="launcher-status-pill launcher-status-pill--muted" onClick={onOpenPlanner}>
              오늘 할 일 추가하기 →
            </button>
          )}
        </div>
      )}

      {/* ── 검색 / 업로드 ── */}
      <div className="launcher-search-row">
        <div className="launcher-search-wrap">
          <svg className="launcher-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="launcher-search-input"
            placeholder="자료나 노트 이름으로 검색…"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus={!isEmpty}
          />
          {q && <button className="launcher-search-clear" onClick={() => setQ("")}>×</button>}
        </div>
        <button className="launcher-upload-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <UploadIcon size="0.9em" />
          {uploading ? "분석 중…" : "자료 추가"}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden onChange={handleFile} />
      </div>

      {/* ── 비어있을 때 드롭존 ── */}
      {isEmpty && (
        <label
          className={`launcher-dropzone ${dragOver ? "launcher-dropzone--over" : ""}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading} onChange={handleFile} />
          <UploadIcon size="2em" />
          <p className="launcher-dz-title">{uploading ? "분석 중…" : "강의자료를 올려보세요"}</p>
          <p className="launcher-dz-sub">PDF 또는 이미지 파일 · 클릭 또는 드래그</p>
        </label>
      )}

      {/* ── 자료 카드 ── */}
      {filteredDocs.length > 0 && (
        <section className="launcher-section">
          <h2 className="launcher-section-title">
            내 자료
            <span className="launcher-section-count">{filteredDocs.length}</span>
          </h2>
          <div className="launcher-doc-grid">
            {filteredDocs.map(d => (
              <div key={d.doc_id} className="launcher-doc-card" onClick={() => onSelectDoc(d.doc_id, d.filename)}>
                <div className="launcher-doc-card-top">
                  <span className="launcher-doc-name" title={d.filename}>
                    {d.filename.replace(/\.pdf$/i, "")}
                  </span>
                  <button className="launcher-doc-del" title="삭제"
                    onClick={e => { e.stopPropagation(); onDeleteDoc(d.doc_id); }}>×</button>
                </div>
                <span className="launcher-doc-date">{timeAgo(d.created_at)}</span>
                {d.status === "processing" && (
                  <span className="launcher-doc-processing">처리 중…</span>
                )}
                <div className="launcher-doc-chips" onClick={e => e.stopPropagation()}>
                  <button className="launcher-chip" onClick={() => onSelectDocTab(d.doc_id, d.filename, "summary")}>요약</button>
                  <button className="launcher-chip" onClick={() => onSelectDocTab(d.doc_id, d.filename, "quiz")}>퀴즈</button>
                  <button className="launcher-chip" onClick={() => onSelectDocTab(d.doc_id, d.filename, "wrong")}>오답노트</button>
                  <button className="launcher-chip" onClick={() => onSelectDocTab(d.doc_id, d.filename, "qa")}>Q&A</button>
                </div>
              </div>
            ))}
            {/* 자료 추가 카드 */}
            {!q && (
              <label className="launcher-doc-card launcher-doc-card--add">
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading} onChange={handleFile} />
                <UploadIcon size="1.2em" />
                <span>{uploading ? "분석 중…" : "자료 추가"}</span>
              </label>
            )}
          </div>
        </section>
      )}

      {/* ── 노트 ── */}
      {filteredNotes.length > 0 && (
        <section className="launcher-section">
          <h2 className="launcher-section-title">
            최근 노트
            <span className="launcher-section-count">{filteredNotes.length}</span>
          </h2>
          <div className="launcher-note-list">
            {filteredNotes.slice(0, 8).map(n => (
              <button key={n.id} className="launcher-note-row" onClick={() => onOpenNote?.(n.id)}>
                <span className="launcher-note-icon">{renderNoteIcon(n.icon, "1em") || <NoteIcon size="1em" />}</span>
                <span className="launcher-note-title">{n.title || "제목 없음"}</span>
                <span className="launcher-note-time">{timeAgo(n.updated_at)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── 검색 결과 없음 ── */}
      {q && filteredDocs.length === 0 && filteredNotes.length === 0 && (
        <p className="launcher-no-result">"{q}"에 대한 결과가 없어요</p>
      )}

      {/* 노트 없을 때 */}
      {!q && pastDocs.length > 0 && notes.length === 0 && (
        <section className="launcher-section">
          <h2 className="launcher-section-title">최근 노트</h2>
          <button className="launcher-note-empty" onClick={() => onCreateNote?.()}>
            <NoteIcon size="1em" /> 첫 노트를 만들어보세요
          </button>
        </section>
      )}
    </div>
  );
}
