import { useState } from "react";
import { loginWithGoogle } from "../firebase";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      await loginWithGoogle();
    } catch {
      setError("로그인에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-root">
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo">SR</div>
          <span className="login-brand-name">StudyRAG</span>
        </div>
        <div className="login-copy">
          <h1 className="login-headline">강의자료를<br />더 똑똑하게</h1>
          <p className="login-desc">PDF를 올리면 AI가 핵심을 파악하고<br />질문에 답하고, 퀴즈를 만들어드려요.</p>
        </div>
        <div className="login-features">
          <div className="lf-item"><span className="lf-dot" />강의 내용 Q&amp;A</div>
          <div className="lf-item"><span className="lf-dot" />자동 퀴즈 생성 &amp; 채점</div>
          <div className="lf-item"><span className="lf-dot" />오답노트 자동 정리</div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          <h2 className="login-card-title">시작하기</h2>
          <p className="login-card-sub">Google 계정으로 바로 사용하세요</p>

          {error && <p className="login-error">{error}</p>}

          <button className="login-google-btn" onClick={handleLogin} disabled={loading}>
            <svg className="login-google-icon" viewBox="0 0 48 48" width="18" height="18">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {loading ? "로그인 중…" : "Google로 계속하기"}
          </button>

          <p className="login-terms">로그인 시 서비스 이용에 동의하게 됩니다.</p>
        </div>
      </div>
    </div>
  );
}
