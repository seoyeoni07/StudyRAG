import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, logout } from "./firebase";
import { apiFetch, setUserId } from "./api";
import QASection from "./components/QASection";
import QuizSection from "./components/QuizSection";
import WrongAnswerBook from "./components/WrongAnswerBook";
import TutorSection from "./components/TutorSection";
import LoginPage from "./components/LoginPage";
import { GradientBlurBg } from "./components/ui/gradient-blur-bg";
import "./App.css";

const TABS = [
  ["qa",    "Q&A",    "원하는 내용 바로 검색"],
  ["tutor", "AI 튜터", "소크라테스식 단계별 학습"],
  ["quiz",  "퀴즈",   "자동 문제 생성·채점"],
  ["wrong", "오답노트","틀린 문제 복습"],
];

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = 로딩 중
  const [docId, setDocId] = useState(null);
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState("qa");
  const [error, setError] = useState("");
  const [pastDocs, setPastDocs] = useState([]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      if (u) {
        setUserId(u.uid);
        apiFetch("/documents/").then(setPastDocs).catch(() => {});
      } else {
        setUserId(null);
        setPastDocs([]);
      }
    });
  }, []);

  if (user === undefined) return null; // 로딩 중
  if (!user) return <LoginPage />;

  async function handleDeleteDoc(doc_id) {
    try {
      await apiFetch(`/documents/${doc_id}`, { method: "DELETE" });
      setPastDocs(prev => prev.filter(d => d.doc_id !== doc_id));
      if (docId === doc_id) { setDocId(null); setFilename(""); }
    } catch (err) {
      setError(err.message);
    }
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
      setTab("qa");
      setPastDocs(prev => [{ doc_id: data.doc_id, filename: data.filename, created_at: new Date().toISOString() }, ...prev]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

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
        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Upload zone ── */}
        {!docId ? (
          <div className="upload-card">
            <label className="upload-empty">
              <input type="file" accept=".pdf" hidden disabled={uploading}
                onChange={(e) => { if (e.target.files?.[0]) handleFilesAccepted([e.target.files[0]]); }} />
              <p className="upload-heading">
                {uploading ? "분석 중…" : "강의자료 PDF 업로드"}
              </p>
              <p className="upload-sub">
                {uploading
                  ? "AI가 내용을 분석하고 있습니다. 잠시만 기다려주세요."
                  : "파일을 클릭해서 선택하거나 이 영역에 드래그하세요."}
              </p>
              {!uploading && (
                <span className="upload-btn">파일 선택</span>
              )}
            </label>

            {pastDocs.length > 0 && (
              <div className="past-docs">
                <p className="past-docs-label">이전에 업로드한 자료</p>
                <div className="past-docs-list">
                  {pastDocs.map(d => (
                    <div key={d.doc_id} className="past-doc-item">
                      <button className="past-doc-main"
                        onClick={() => { setDocId(d.doc_id); setFilename(d.filename); setTab("qa"); }}>
                        <span className="past-doc-name">{d.filename}</span>
                        <span className="past-doc-date">{new Date(d.created_at).toLocaleDateString("ko-KR")}</span>
                      </button>
                      <button className="past-doc-del" onClick={() => handleDeleteDoc(d.doc_id)}
                        title="삭제">×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="upload-card upload-done">
            <span className="upload-success">✓ {filename}</span>
            <label style={{ marginLeft: "auto", cursor: "pointer" }}>
              <input type="file" accept=".pdf" hidden disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFilesAccepted([e.target.files[0]]);
                    e.target.value = "";
                  }
                }} />
              <span className="upload-change">{uploading ? "처리 중…" : "다른 파일"}</span>
            </label>
          </div>
        )}

        {/* ── Tab content ── */}
        {docId && (
          <>
            <div className="tabs">
              {TABS.map(([key, label, desc]) => (
                <button key={key} className={`tab ${tab === key ? "active" : ""}`}
                  onClick={() => setTab(key)} title={desc}>
                  {label}
                </button>
              ))}
            </div>
            <div className="card">
              <div key={tab} className="tab-panel">
                {tab === "qa"    && <QASection docId={docId} />}
                {tab === "tutor" && <TutorSection docId={docId} />}
                {tab === "quiz"  && <QuizSection docId={docId} />}
                {tab === "wrong" && <WrongAnswerBook docId={docId} />}
              </div>
            </div>
          </>
        )}
      </div>
    </GradientBlurBg>
  );
}
