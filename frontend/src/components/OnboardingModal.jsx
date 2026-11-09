import { useState } from "react";
import { apiFetch } from "../api";

const USER_TYPES = [
  { value: "대학생", label: "대학생" },
  { value: "고등학생", label: "고등학생" },
  { value: "자격증준비", label: "자격증 준비" },
  { value: "직장인", label: "직장인" },
  { value: "기타", label: "기타" },
];

export default function OnboardingModal({ onDone }) {
  const [userType, setUserType] = useState("");
  const [majorOrGoal, setMajorOrGoal] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!userType) return;
    setSaving(true);
    try {
      await apiFetch("/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_type: userType, major_or_goal: majorOrGoal.trim() || null }),
      });
      onDone({ user_type: userType, major_or_goal: majorOrGoal.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="share-modal-overlay">
      <div className="share-modal" style={{ maxWidth: 440 }}>
        <div className="share-modal-header">반가워요! 먼저 간단히 알려주세요</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text-muted)" }}>나는 어떤 학습자인가요?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {USER_TYPES.map(t => (
                <button key={t.value}
                  className={userType === t.value ? "btn-primary" : "btn-secondary"}
                  style={{ fontSize: 13, padding: "5px 14px" }}
                  onClick={() => setUserType(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontSize: 13, marginBottom: 6, color: "var(--text-muted)" }}>
              {userType === "자격증준비" ? "목표 자격증" : "전공 또는 주요 공부 분야"}
              <span style={{ fontWeight: 400 }}> (선택)</span>
            </p>
            <input className="input" placeholder={
              userType === "자격증준비" ? "예: 정보처리기사, 공인중개사" :
              userType === "고등학생" ? "예: 수능, 이과, 문과" :
              "예: 컴퓨터공학, 경영학"
            } value={majorOrGoal} onChange={e => setMajorOrGoal(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={!userType || saving} onClick={save}>
            {saving ? "저장 중…" : "시작하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
