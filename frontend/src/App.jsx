import { useState } from "react";
import { apiFetch } from "./api";
import QASection from "./components/QASection";
import QuizSection from "./components/QuizSection";
import WrongAnswerBook from "./components/WrongAnswerBook";
import { GradientBlurBg } from "./components/ui/gradient-blur-bg";
import { FileUpload } from "./components/ui/file-upload-2";
import "./App.css";

const TABS = [["qa", "Q&A"], ["quiz", "퀴즈"], ["wrong", "오답노트"]];

const FEATURES = [
  { name: "Q&A", desc: "강의 내용 질문·검색" },
  { name: "퀴즈", desc: "자동 문제 생성·채점" },
  { name: "오답노트", desc: "틀린 문제 복습 정리" },
];

export default function App() {
  const [docId, setDocId] = useState(null);
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState("qa");
  const [error, setError] = useState("");

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
            <div className="features">
              <div className="features-grid">
                {FEATURES.map(f => (
                  <div key={f.name} className="feature-card">
                    <strong className="feature-name">{f.name}</strong>
                    <p className="feature-desc">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
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
              {TABS.map(([key, label]) => (
                <button key={key} className={`tab ${tab === key ? "active" : ""}`}
                  onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="card">
              <div key={tab} className="tab-panel">
                {tab === "qa"    && <QASection docId={docId} />}
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
