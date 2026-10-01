import { useState } from "react";

export const DOC_TABS = [
  ["summary", "요약",       "AI가 강의 전체를 핵심만 정리해드립니다", "📋"],
  ["qa",      "Q&A",        "물어보면 답을 바로 줍니다", "💬"],
  ["tutor",   "AI 튜터",    "답 대신 이해할 때까지 가르쳐줍니다", "🧑‍🏫"],
  ["quiz",    "퀴즈",        "자동 문제 생성·채점", "✅"],
  ["wrong",   "오답노트",    "틀린 문제 복습", "📕"],
  ["room",    "그룹 스터디", "친구와 함께 같은 문제 풀고 점수 비교", "👥"],
];

function Caret({ open, onClick }) {
  return (
    <span className={`sb-caret ${open ? "open" : ""}`} role="button" aria-label={open ? "접기" : "펼치기"}
      onClick={e => { e.stopPropagation(); onClick(); }}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

export default function Sidebar({
  user, view, onNavigate, pastDocs, notes, wrongCount,
  onNewNote, onUpload, uploading, onLogout, open, onClose,
}) {
  const [expanded, setExpanded] = useState({});
  const [docsOpen, setDocsOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const name = user.displayName || user.email?.split("@")[0] || "나";

  const isOpen = (id) => expanded[id] ?? (view.type === "doc" && view.docId === id);
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !isOpen(id) }));
  const go = (v) => { onNavigate(v); onClose?.(); };

  const looseNotes = notes.filter(n => !n.doc_id || !pastDocs.some(d => d.doc_id === n.doc_id));

  return (
    <>
      <div className={`sb-backdrop ${open ? "show" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sb-workspace">
          <span className="sb-ws-icon">{name.slice(0, 1).toUpperCase()}</span>
          <span className="sb-ws-name">{name}의 StudyRAG</span>
        </div>

        <nav className="sb-scroll">
          <button className={`sb-item ${view.type === "home" ? "active" : ""}`} onClick={() => go({ type: "home" })}>
            <span className="sb-icon">🏠</span><span className="sb-label">홈</span>
          </button>
          <label className="sb-item">
            <input type="file" accept=".pdf" hidden disabled={uploading}
              onChange={e => { if (e.target.files?.[0]) { onUpload([e.target.files[0]]); e.target.value = ""; onClose?.(); } }} />
            <span className="sb-icon">⬆️</span><span className="sb-label">{uploading ? "분석 중…" : "PDF 업로드"}</span>
          </label>

          {/* ── 노트 ── */}
          <div className="sb-section">
            <div className="sb-section-head">
              <button className="sb-section-title" onClick={() => setNotesOpen(o => !o)}>내 노트</button>
              <button className="sb-add" title="새 노트" onClick={() => { onNewNote(); onClose?.(); }}>+</button>
            </div>
            {notesOpen && (
              looseNotes.length === 0 ? (
                <button className="sb-item sb-muted" onClick={() => { onNewNote(); onClose?.(); }}>
                  <span className="sb-icon">＋</span><span className="sb-label">새 노트 만들기</span>
                </button>
              ) : looseNotes.map(n => (
                <button key={n.id} className={`sb-item ${view.type === "note" && view.noteId === n.id ? "active" : ""}`}
                  onClick={() => go({ type: "note", noteId: n.id })}>
                  <span className="sb-icon">{n.icon || "📝"}</span>
                  <span className="sb-label">{n.title || "제목 없음"}</span>
                </button>
              ))
            )}
          </div>

          {/* ── 자료 ── */}
          <div className="sb-section">
            <div className="sb-section-head">
              <button className="sb-section-title" onClick={() => setDocsOpen(o => !o)}>강의자료</button>
            </div>
            {docsOpen && (pastDocs.length === 0 ? (
              <p className="sb-empty">아직 자료가 없어요</p>
            ) : pastDocs.map(d => {
              const docNotes = notes.filter(n => n.doc_id === d.doc_id);
              const active = view.type === "doc" && view.docId === d.doc_id;
              return (
                <div key={d.doc_id}>
                  <button className={`sb-item ${active && !isOpen(d.doc_id) ? "active" : ""}`}
                    onClick={() => go({ type: "doc", docId: d.doc_id, filename: d.filename, tab: active ? view.tab : "summary" })}
                    title={d.filename}>
                    <Caret open={isOpen(d.doc_id)} onClick={() => toggle(d.doc_id)} />
                    <span className="sb-icon">📄</span>
                    <span className="sb-label">{d.filename.replace(/\.pdf$/i, "")}</span>
                  </button>
                  {isOpen(d.doc_id) && (
                    <div className="sb-children">
                      {DOC_TABS.map(([key, label, , icon]) => (
                        <button key={key} className={`sb-item sb-child ${active && view.tab === key ? "active" : ""}`}
                          onClick={() => go({ type: "doc", docId: d.doc_id, filename: d.filename, tab: key })}>
                          <span className="sb-icon">{icon}</span>
                          <span className="sb-label">{label}</span>
                          {key === "wrong" && active && wrongCount > 0 && <span className="sb-badge">{wrongCount}</span>}
                        </button>
                      ))}
                      {docNotes.map(n => (
                        <button key={n.id} className={`sb-item sb-child ${view.type === "note" && view.noteId === n.id ? "active" : ""}`}
                          onClick={() => go({ type: "note", noteId: n.id })}>
                          <span className="sb-icon">{n.icon || "📝"}</span>
                          <span className="sb-label">{n.title || "제목 없음"}</span>
                        </button>
                      ))}
                      <button className="sb-item sb-child sb-muted" onClick={() => { onNewNote(d.doc_id); onClose?.(); }}>
                        <span className="sb-icon">＋</span><span className="sb-label">이 자료에 노트 추가</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            }))}
          </div>
        </nav>

        <div className="sb-footer">
          <span className="sb-user" title={user.email}>{user.email || name}</span>
          <button className="sb-logout" onClick={onLogout}>로그아웃</button>
        </div>
      </aside>
    </>
  );
}
