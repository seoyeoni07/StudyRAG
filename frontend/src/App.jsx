import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, logout } from "./firebase";
import { apiFetch, setUserId, ColdStartError } from "./api";
import QASection from "./components/QASection";
import QuizSection from "./components/QuizSection";
import WrongAnswerBook from "./components/WrongAnswerBook";
import TutorSection from "./components/TutorSection";
import SummarySection from "./components/SummarySection";
import StudyRoomSection from "./components/StudyRoomSection";
import DashboardHome from "./components/DashboardHome";
import LoginPage from "./components/LoginPage";
import { GradientBlurBg } from "./components/ui/gradient-blur-bg";
import "./App.css";

const TABS = [
  ["summary", "요약",       "AI가 강의 전체를 핵심만 정리해드립니다"],
  ["qa",      "Q&A",        "물어보면 답을 바로 줍니다"],
  ["tutor",   "AI 튜터",    "답 대신 이해할 때까지 가르쳐줍니다"],
  ["quiz",    "퀴즈",        "자동 문제 생성·채점"],
  ["wrong",   "오답노트",    "틀린 문제 복습"],
  ["room",    "그룹 스터디", "친구와 함께 같은 문제 풀고 점수 비교"],
];

export default function App() {
  const [user, setUser] = useState(undefined);
  const [docId, setDocId] = useState(null);
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState("summary");
  const [error, setError] = useState("");
  const [pastDocs, setPastDocs] = useState([]);
  const [wrongCount, setWrongCount] = useState(0);
  const [preJoined, setPreJoined] = useState(null);
  const [serverWaking, setServerWaking] = useState(false);

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
      } else {
        setUserId(null);
        setPastDocs([]);
        setServerWaking(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!docId) { setWrongCount(0); setPreJoined(null); }
  }, [docId]);

  if (user === undefined) return null;
  if (!user) return <LoginPage />;

  async function handleDeleteDoc(doc_id) {
    try {
      await apiFetch(`/documents/${doc_id}`, { method: "DELETE" });
      setPastDocs(prev => prev.filter(d => d.doc_id !== doc_id));
      if (docId === doc_id) { setDocId(null); setFilename(""); }
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
      setDocId(data.doc_id);
      setFilename(data.filename);
      setTab("summary");
      setServerWaking(false);
      setPastDocs(prev => [{ doc_id: data.doc_id, filename: data.filename, created_at: new Date().toISOString() }, ...prev]);
    } catch (err) {
      if (err.isColdStart) setServerWaking(true);
      else setError(err.message);
    }
    finally { setUploading(false); }
  }

  function selectDoc(id, name, targetTab = "summary") {
    setDocId(id);
    setFilename(name);
    setTab(targetTab);
    setWrongCount(0);
    setPreJoined(null);
  }

  function handleJoinRoom(room_id, doc_id, nickname) {
    setDocId(doc_id);
    setFilename("그룹 스터디 참여 중");
    setTab("room");
    setPreJoined({ room_id, nickname });
  }

  const tabLabel = (key, label) => {
    if (key === "wrong" && wrongCount > 0) return `${label} (${wrongCount})`;
    return label;
  };

  return (
    <GradientBlurBg>
      <header className="header">
        <div className="header-logo">SR</div>
        <span className="header-title">StudyRAG</span>
        <span className="header-sub">/ 강의자료 AI 학습</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="header-user">{user.displayName}</span>
          <button onClick={logout} className="header-logout">로그아웃</button>
        </div>
      </header>

      <div className="container">
        {serverWaking && (
          <div className="server-waking-banner">
            <div className="spinner spinner-sm" />
            <span>서버를 시작하는 중입니다. 최대 1분 소요돼요 — 자동으로 연결됩니다.</span>
          </div>
        )}
        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Upload zone / Dashboard / Doc header ── */}
        {!docId ? (
          <DashboardHome
            onFileAccepted={handleFilesAccepted}
            onSelectDoc={(id, name) => selectDoc(id, name, "summary")}
            onSelectDocTab={selectDoc}
            onDeleteDoc={handleDeleteDoc}
            pastDocs={pastDocs}
            uploading={uploading}
            onPastDocsChange={() => apiFetch("/documents/").then(setPastDocs).catch(() => {})}
            onJoinRoom={handleJoinRoom}
          />
        ) : (
          <div className="upload-card upload-done">
            <button className="back-btn" onClick={() => { setDocId(null); setFilename(""); }}
              title="대시보드로">← 대시보드</button>
            <span className="upload-success">✓</span>
            {/* 자료 빠른 전환 드롭다운 */}
            <select className="doc-switcher" value={docId}
              onChange={e => {
                const d = pastDocs.find(p => p.doc_id === e.target.value);
                if (d) selectDoc(d.doc_id, d.filename, tab);
              }}>
              {pastDocs.map(d => (
                <option key={d.doc_id} value={d.doc_id}>{d.filename}</option>
              ))}
            </select>
            <label style={{ marginLeft: "auto", cursor: "pointer" }}>
              <input type="file" accept=".pdf" hidden disabled={uploading}
                onChange={(e) => { if (e.target.files?.[0]) { handleFilesAccepted([e.target.files[0]]); e.target.value = ""; } }} />
              <span className="upload-change">{uploading ? "처리 중…" : "다른 파일"}</span>
            </label>
          </div>
        )}

        {/* ── Tab content ── */}
        {docId && (
          <>
            <div className="tabs" role="tablist" aria-label="학습 메뉴">
              {TABS.map(([key, label, desc]) => (
                <button key={key} className={`tab ${tab === key ? "active" : ""}`}
                  role="tab" aria-selected={tab === key} aria-controls={`panel-${key}`}
                  id={`tab-${key}`}
                  onClick={() => setTab(key)} title={desc}>
                  {tabLabel(key, label)}
                </button>
              ))}
            </div>
            <p className="tab-desc" aria-live="polite">{TABS.find(([k]) => k === tab)?.[2]}</p>
            <div className="card">
              {[
                ["summary", <SummarySection docId={docId} />],
                ["qa",      <QASection docId={docId} />],
                ["tutor",   <TutorSection docId={docId} />],
                ["quiz",    <QuizSection docId={docId} onGoToWrong={() => setTab("wrong")} />],
                ["wrong",   <WrongAnswerBook docId={docId}
                              onCountLoaded={setWrongCount}
                              onGoToQuiz={() => setTab("quiz")} />],
                ["room",    <StudyRoomSection docId={docId} userId={user?.uid} preJoined={preJoined} />],
              ].map(([key, el]) => (
                <div key={key} className="tab-panel" role="tabpanel" id={`panel-${key}`}
                  aria-labelledby={`tab-${key}`}
                  style={{ display: tab === key ? "" : "none" }}>
                  {el}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </GradientBlurBg>
  );
}
