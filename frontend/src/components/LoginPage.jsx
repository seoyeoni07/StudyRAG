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
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
      gap: "2rem",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "3rem", fontWeight: 800, color: "#166534", letterSpacing: "-1px" }}>
          StudyRAG
        </div>
        <div style={{ color: "#4b7c5e", marginTop: "0.5rem", fontSize: "1.1rem" }}>
          강의자료 AI 학습 도우미
        </div>
      </div>

      <div style={{
        background: "white",
        borderRadius: "1.5rem",
        padding: "2.5rem",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.5rem",
        minWidth: "320px",
      }}>
        <div style={{ fontSize: "1rem", color: "#374151", textAlign: "center" }}>
          PDF를 올리고 AI와 함께 공부하세요
        </div>

        {error && (
          <div style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1.5rem",
            border: "1px solid #e5e7eb",
            borderRadius: "0.75rem",
            background: "white",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#374151",
            width: "100%",
            justifyContent: "center",
            opacity: loading ? 0.6 : 1,
            transition: "box-shadow 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "로그인 중..." : "Google로 로그인"}
        </button>
      </div>
    </div>
  );
}
