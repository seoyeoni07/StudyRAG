import { useState } from "react";
import { apiFetch } from "../api";

const USER_TYPES = ["대학생", "고등학생", "자격증 준비", "직장인", "기타"];
const PURPOSES = ["시험 준비", "수업 복습", "자기계발", "취업 준비"];
const LEVELS = ["입문", "중급", "고급"];

export default function OnboardingModal({ onDone, onSkip }) {
  const [userType, setUserType] = useState("");
  const [userTypeCustom, setUserTypeCustom] = useState("");
  const [majorOrGoal, setMajorOrGoal] = useState("");
  const [purpose, setPurpose] = useState("");
  const [level, setLevel] = useState("");
  const [saving, setSaving] = useState(false);

  const typeValue = userType === "기타" ? "기타" : userType.replace(" ", "");

  async function save() {
    if (!userType || !purpose || !level) return;
    setSaving(true);
    try {
      await apiFetch("/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_type: typeValue,
          user_type_custom: userType === "기타" ? userTypeCustom.trim() || null : null,
          major_or_goal: majorOrGoal.trim() || null,
          learning_purpose: purpose,
          skill_level: level,
        }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = userType && (userType !== "기타" || userTypeCustom.trim()) && purpose && level;

  return (
    <div className="share-modal-overlay">
      <div className="share-modal" style={{ maxWidth: 440 }}>
        <div className="share-modal-header">
          반가워요! 먼저 간단히 알려주세요
          <button className="btn-ghost btn-sm" onClick={onSkip} style={{ fontWeight: 400, fontSize: 12 }}>나중에</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          <div>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text-muted)" }}>나는 어떤 학습자인가요?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {USER_TYPES.map(t => (
                <button key={t}
                  className={userType === t ? "btn-primary" : "btn-secondary"}
                  style={{ fontSize: 13, padding: "5px 14px" }}
                  onClick={() => setUserType(t)}>
                  {t}
                </button>
              ))}
            </div>
            {userType === "기타" && (
              <input className="input" style={{ marginTop: 8 }}
                placeholder="직접 입력해주세요"
                value={userTypeCustom} onChange={e => setUserTypeCustom(e.target.value)} />
            )}
          </div>

          <div>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text-muted)" }}>
              {userType === "자격증 준비" ? "목표 자격증" : "전공 또는 주요 공부 분야"}
              <span style={{ fontWeight: 400 }}> (선택)</span>
            </p>
            <input className="input" placeholder={
              userType === "자격증 준비" ? "예: 정보처리기사, 공인중개사" :
              userType === "고등학생" ? "예: 수능, 이과, 문과" :
              "예: 컴퓨터공학, 경영학"
            } value={majorOrGoal} onChange={e => setMajorOrGoal(e.target.value)} />
          </div>

          <div>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text-muted)" }}>학습 목적이 뭔가요?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PURPOSES.map(p => (
                <button key={p}
                  className={purpose === p ? "btn-primary" : "btn-secondary"}
                  style={{ fontSize: 13, padding: "5px 14px" }}
                  onClick={() => setPurpose(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text-muted)" }}>현재 수준은요?</p>
            <div style={{ display: "flex", gap: 8 }}>
              {LEVELS.map(l => (
                <button key={l}
                  className={level === l ? "btn-primary" : "btn-secondary"}
                  style={{ fontSize: 13, padding: "5px 14px" }}
                  onClick={() => setLevel(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <button className="btn-primary" disabled={!canSubmit || saving} onClick={save}
            style={{ marginTop: 4 }}>
            {saving ? "저장 중…" : "시작하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
