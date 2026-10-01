import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, logout } from "./firebase";
import { apiFetch, setUserId } from "./api";
import QASection from "./components/QASection";
import QuizSection from "./components/QuizSection";
import WrongAnswerBook from "./components/WrongAnswerBook";
import TutorSection from "./components/TutorSection";
import SummarySection from "./components/SummarySection";
import StudyRoomSection from "./components/StudyRoomSection";
import DashboardHome from "./components/DashboardHome";
import LoginPage from "./components/LoginPage";
import Sidebar, { DOC_TABS } from "./components/Sidebar";
import NotePage from "./components/NotePage";
import "./App.css";

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

export default function App() {
  const [user, setUser] = useState(undefined);
  // view: { type: "home" } | { type: "doc", docId, filename, tab } | { type: "note", noteId }
  const [view, setView] = useState({ type: "home" });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pastDocs, setPastDocs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [wrongCount, setWrongCount] = useState(0);
  const [preJoined, setPreJoined] = useState(null);
  const [serverWaking, setServerWaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      if (u) {
        setUserId(u.uid);
        setServerWaking(false);
        apiFetch("/documents/")
          .then(data => { setPastDocs(data); setServerWaking(false); })
          .catch(err => {
            if (err.isColdStart) setServerWaking(true);
          });
        apiFetch("/notes/").then(setNotes).catch(() => {});
      } else {
        setUserId(null);
        setPastDocs([]);
        setNotes([]);
        setView({ type: "home" });
        setServerWaking(false);
      }
    });
  }, []);

  const docId = view.type === "doc" ? view.docId : null;

  useEffect(() => {
    setWrongCount(0);
  }, [docId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  if (user === undefined) return null;
  if (!user) return <LoginPage />;

  async function handleDeleteDoc(doc_id) {
    try {
      await apiFetch(`/documents/${doc_id}`, { method: "DELETE" });
      setPastDocs(prev => prev.filter(d => d.doc_id !== doc_id));
      if (docId === doc_id) setView({ type: "home" });
    } catch (err) { setError(err.message); }
  }

  async function handleFilesAccepted(files) {
    if (!files[0]) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", files[0]);
      const data = await apiFetch("/documents/upload", { method: "POST", body: form });
      setServerWaking(false);
      setPastDocs(prev => [{ doc_id: data.doc_id, filename: data.filename, created_at: new Date().toISOString() }, ...prev]);
      setPreJoined(null);
      setView({ type: "doc", docId: data.doc_id, filename: data.filename, tab: "summary" });
    } catch (err) {
      if (err.isColdStart) setServerWaking(true);
      else setError(err.message);
    }
    finally { setUploading(false); }
  }

  function selectDoc(id, name, targetTab = "summary") {
    setPreJoined(null);
    setView({ type: "doc", docId: id, filename: name, tab: targetTab });
  }

  function handleJoinRoom(room_id, doc_id, nickname) {
    setPreJoined({ room_id, nickname });
    setView({ type: "doc", docId: doc_id, filename: "그룹 스터디 참여 중", tab: "room" });
  }

  async function createNote({ title = "", content = "", doc_id = null } = {}, open = true) {
    try {
      const n = await apiFetch("/notes/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, doc_id, icon: "📝" }),
      });
      setNotes(prev => [n, ...prev]);
      if (open) setView({ type: "note", noteId: n.id });
      return n;
    } catch (err) { setError(err.message); }
  }

  async function saveToNote(title, content) {
    const n = await createNote({ title, content, doc_id: docId }, false);
    if (n) setToast(`"${title.slice(0, 24)}" 노트로 저장했어요`);
  }

  const displayName = user.displayName || user.email?.split("@")[0] || "";
  const currentDoc = docId ? (pastDocs.find(d => d.doc_id === docId) || { doc_id: docId, filename: view.filename }) : null;
  const currentNote = view.type === "note" ? notes.find(n => n.id === view.noteId) : null;
  const currentTab = view.type === "doc" ? DOC_TABS.find(([k]) => k === view.tab) : null;
  const docNotes = docId ? notes.filter(n => n.doc_id === docId) : [];
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 6 ? "늦은 밤이에요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
  })();

  // breadcrumb
  const crumbs = view.type === "home" ? [["🏠", "홈"]]
    : view.type === "doc" ? [["📄", currentDoc?.filename?.replace(/\.pdf$/i, "")], [currentTab?.[3], currentTab?.[1]]]
    : (() => {
        const linked = currentNote?.doc_id && pastDocs.find(d => d.doc_id === currentNote.doc_id);
        return [
          ...(linked ? [["📄", linked.filename.replace(/\.pdf$/i, "")]] : [["📝", "내 노트"]]),
          [currentNote?.icon || "📝", currentNote?.title || "제목 없음"],
        ];
      })();

  return (
    <div className="app-shell">
      <Sidebar
        user={user} view={view} onNavigate={setView}
        pastDocs={pastDocs} notes={notes} wrongCount={wrongCount}
        onNewNote={(doc_id) => createNote({ doc_id: doc_id || null })}
        onUpload={handleFilesAccepted} uploading={uploading}
        onLogout={logout}
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
      />

      <div className="main">
        <div className="topbar">
          <button className="topbar-menu" onClick={() => setSidebarOpen(true)} aria-label="메뉴 열기">
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <nav className="breadcrumb" aria-label="현재 위치">
            {crumbs.map(([icon, label], i) => (
              <span key={i} className="crumb">
                {i > 0 && <span className="crumb-sep">/</span>}
                <span className="crumb-icon">{icon}</span>
                <span className="crumb-label">{label}</span>
              </span>
            ))}
          </nav>
        </div>

        <div className="page">
          {serverWaking && (
            <div className="callout callout--amber">
              <div className="spinner spinner-sm" />
              <span>서버를 시작하는 중입니다. 최대 1분 소요돼요 — 자동으로 연결됩니다.</span>
            </div>
          )}
          {error && (
            <div className="error-banner">
              <span className="error-icon">⚠️</span>
              <span style={{ flex: 1 }}>{error}</span>
              <button className="btn-ghost" onClick={() => setError("")}>닫기</button>
            </div>
          )}

          {view.type === "home" && (
            <>
              <div className="page-icon">🏠</div>
              <h1 className="page-title">{greeting}{displayName ? `, ${displayName}님` : ""}</h1>

              <DashboardHome
                onFileAccepted={handleFilesAccepted}
                onSelectDoc={(id, name) => selectDoc(id, name, "summary")}
                onSelectDocTab={selectDoc}
                onDeleteDoc={handleDeleteDoc}
                pastDocs={pastDocs}
                uploading={uploading}
                onPastDocsChange={() => apiFetch("/documents/").then(setPastDocs).catch(() => {})}
                onJoinRoom={handleJoinRoom}
                notesSlot={
                  <div className="dash-section">
                    <div className="dash-section-header">
                      <p className="dash-section-title">최근 노트</p>
                      <button className="btn-ghost" onClick={() => createNote()}>+ 새 노트</button>
                    </div>
                    {notes.length === 0 ? (
                      <button className="note-empty" onClick={() => createNote()}>
                        <span>📝</span> 첫 노트를 만들어보세요. 강의 정리, 질문 메모, 시험 대비 요점 무엇이든요.
                      </button>
                    ) : (
                      <div className="note-gallery">
                        {notes.slice(0, 6).map(n => (
                          <button key={n.id} className="note-card" onClick={() => setView({ type: "note", noteId: n.id })}>
                            <span className="note-card-icon">{n.icon || "📝"}</span>
                            <span className="note-card-title">{n.title || "제목 없음"}</span>
                            <span className="note-card-meta">{timeAgo(n.updated_at)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
            </>
          )}

          {view.type === "note" && (
            <NotePage
              key={view.noteId}
              noteId={view.noteId}
              pastDocs={pastDocs}
              onChanged={(saved) => setNotes(prev => [{ ...saved, content: undefined }, ...prev.filter(n => n.id !== saved.id)])}
              onDeleted={(id) => { setNotes(prev => prev.filter(n => n.id !== id)); setView({ type: "home" }); }}
              onOpenDoc={(id, name) => selectDoc(id, name, "summary")}
            />
          )}

          {view.type === "doc" && (
            <>
              <div className="page-icon">📄</div>
              <h1 className="page-title page-title--doc" title={currentDoc?.filename}>
                {currentDoc?.filename?.replace(/\.pdf$/i, "")}
              </h1>

              <div className="doc-meta-row">
                {docNotes.map(n => (
                  <button key={n.id} className="doc-note-chip" onClick={() => setView({ type: "note", noteId: n.id })}>
                    {n.icon || "📝"} {n.title || "제목 없음"}
                  </button>
                ))}
                <button className="doc-note-chip doc-note-chip--add" onClick={() => createNote({ doc_id: docId })}>
                  + 노트 추가
                </button>
              </div>

              <div className="tabs" role="tablist" aria-label="학습 메뉴">
                {DOC_TABS.map(([key, label, desc, icon]) => (
                  <button key={key} className={`tab ${view.tab === key ? "active" : ""}`}
                    role="tab" aria-selected={view.tab === key} aria-controls={`panel-${key}`}
                    id={`tab-${key}`} title={desc}
                    onClick={() => setView(v => ({ ...v, tab: key }))}>
                    <span className="tab-icon">{icon}</span>
                    {label}
                    {key === "wrong" && wrongCount > 0 && <span className="tab-count">{wrongCount}</span>}
                  </button>
                ))}
              </div>
              <p className="tab-desc" aria-live="polite">{currentTab?.[2]}</p>

              <div key={docId}>
                {[
                  ["summary", <SummarySection key="summary" docId={docId} onSaveNote={saveToNote} />],
                  ["qa",      <QASection key="qa" docId={docId} onSaveNote={saveToNote} />],
                  ["tutor",   <TutorSection key="tutor" docId={docId} />],
                  ["quiz",    <QuizSection key="quiz" docId={docId} onGoToWrong={() => setView(v => ({ ...v, tab: "wrong" }))} />],
                  ["wrong",   <WrongAnswerBook key="wrong" docId={docId}
                                onCountLoaded={setWrongCount}
                                onGoToQuiz={() => setView(v => ({ ...v, tab: "quiz" }))} />],
                  ["room",    <StudyRoomSection key="room" docId={docId} userId={user?.uid} preJoined={preJoined} />],
                ].map(([key, el]) => (
                  <div key={key} className="tab-panel" role="tabpanel" id={`panel-${key}`}
                    aria-labelledby={`tab-${key}`}
                    style={{ display: view.tab === key ? "" : "none" }}>
                    {el}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
