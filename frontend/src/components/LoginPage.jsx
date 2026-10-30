import { useState } from "react";
import { loginWithGoogle, loginWithEmail, signUpWithEmail } from "../firebase";

const ERROR_MAP = {
  "auth/user-not-found":       "등록되지 않은 이메일입니다.",
  "auth/wrong-password":       "비밀번호가 틀렸습니다.",
  "auth/invalid-credential":   "이메일 또는 비밀번호가 잘못됐습니다.",
  "auth/email-already-in-use": "이미 사용 중인 이메일입니다.",
  "auth/weak-password":        "비밀번호는 6자 이상이어야 합니다.",
  "auth/invalid-email":        "이메일 형식이 올바르지 않습니다.",
  "auth/too-many-requests":    "잠시 후 다시 시도해주세요.",
};

function firebaseMsg(err) {
  const code = err?.code || "";
  return ERROR_MAP[code] || err?.message || "오류가 발생했습니다.";
}

const FEATURES = [
  { icon: "🔍", color: "blue",  title: "문서 Q&A",     desc: "강의자료 어디에서든 바로 답을 찾아줘요" },
  { icon: "🤖", color: "teal",  title: "AI 튜터",       desc: "답이 아닌 이해, 소크라테스식 1:1 대화" },
  { icon: "✏️", color: "amber", title: "자동 퀴즈 생성", desc: "간격 반복으로 오답을 완전히 없애줘요" },
  { icon: "👥", color: "pink",  title: "그룹 스터디",    desc: "함께 자료를 보고, 같이 퀴즈를 풀어요" },
  { icon: "📝", color: "green", title: "스마트 노트",    desc: "자료와 연결된 노트, 팀과 실시간 공유" },
];

export default function LoginPage() {
  const [tab, setTab] = useState("google");     // google | email
  const [mode, setMode] = useState("login");    // login | signup
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGoogle() {
    setLoading(true); setError("");
    try { await loginWithGoogle(); }
    catch (e) { setError(firebaseMsg(e)); }
    finally { setLoading(false); }
  }

  async function handleEmail(e) {
    e.preventDefault();
    if (!email.trim() || !pw.trim()) return;
    setLoading(true); setError("");
    try {
      if (mode === "login") await loginWithEmail(email, pw);
      else await signUpWithEmail(email, pw, name.trim() || undefined);
    } catch (err) { setError(firebaseMsg(err)); }
    finally { setLoading(false); }
  }

  return (
    <div className="login-root">
      {/* ── 왼쪽 히어로 패널 ── */}
      <div className="login-left">
        <div className="login-left-brand">
          <div className="login-logo">SR</div>
          <span className="login-brand-name">StudyRAG</span>
        </div>

        <h2 className="login-left-headline">
          강의자료를<br /><span>더 깊이, 더 빠르게.</span>
        </h2>
        <p className="login-left-sub">
          PDF·이미지 강의자료를 올리면 AI가 요약하고, 질문에 답하고,
          퀴즈를 만들고, 오답을 추적해요. 혼자도, 팀도.
        </p>

        <div className="login-features">
          {FEATURES.map(f => (
            <div className="login-feat" key={f.title}>
              <div className={`login-feat-icon login-feat-icon--${f.color}`}>{f.icon}</div>
              <div>
                <div className="login-feat-title">{f.title}</div>
                <div className="login-feat-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 오른쪽 로그인 폼 ── */}
      <div className="login-right">
        <div className="login-card">
          <div className="login-card-logo">
            <div className="login-card-logo-mark">SR</div>
            <span className="login-card-logo-name">StudyRAG</span>
          </div>

          <div className="login-card-heading">
            <h1 className="login-card-title">{mode === "signup" ? "회원가입" : "시작하기"}</h1>
            <p className="login-card-sub">강의자료를 AI로 완전히 소화하세요.</p>
          </div>

          <div className="login-tabs">
            <button className={`login-tab ${tab === "google" ? "active" : ""}`} onClick={() => { setTab("google"); setError(""); }}>
              Google
            </button>
            <button className={`login-tab ${tab === "email" ? "active" : ""}`} onClick={() => { setTab("email"); setError(""); }}>
              이메일
            </button>
          </div>

          {error && <p className="login-error">{error}</p>}

          {tab === "google" && (
            <button className="login-google-btn" onClick={handleGoogle} disabled={loading}>
              <svg viewBox="0 0 48 48" width="18" height="18">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              {loading ? "로그인 중…" : "Google로 계속하기"}
            </button>
          )}

          {tab === "email" && (
            <form className="login-email-form" onSubmit={handleEmail} noValidate>
              {mode === "signup" && (
                <input className="input" type="text" placeholder="이름 (선택)" value={name}
                  onChange={e => setName(e.target.value)} disabled={loading} />
              )}
              <input className="input" type="email" placeholder="이메일" value={email}
                onChange={e => setEmail(e.target.value)} disabled={loading} required autoComplete="email" />
              <input className="input" type="password" placeholder="비밀번호" value={pw}
                onChange={e => setPw(e.target.value)} disabled={loading} required autoComplete={mode === "signup" ? "new-password" : "current-password"} />
              <button className="btn-primary login-submit-btn" type="submit" disabled={loading || !email.trim() || !pw.trim()}>
                {loading ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
              </button>
              <p className="login-mode-toggle">
                {mode === "login" ? "계정이 없으신가요? " : "이미 계정이 있으신가요? "}
                <button type="button" className="login-mode-btn"
                  onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
                  {mode === "login" ? "회원가입" : "로그인"}
                </button>
              </p>
            </form>
          )}

          <p className="login-terms">로그인 시 서비스 이용에 동의하게 됩니다.</p>
        </div>
      </div>
    </div>
  );
}
