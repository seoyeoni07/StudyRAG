import { useState } from "react";
import { auth, updateUserProfile, changePassword, sendVerificationEmail } from "../firebase";

const FIREBASE_ERRORS = {
  "auth/wrong-password":        "현재 비밀번호가 틀렸어요.",
  "auth/weak-password":         "비밀번호는 6자 이상이어야 해요.",
  "auth/too-many-requests":     "요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
  "auth/requires-recent-login": "보안을 위해 다시 로그인 후 시도해주세요.",
  "auth/email-already-in-use":  "이미 사용 중인 이메일이에요.",
};
const fmtErr = (e) => FIREBASE_ERRORS[e?.code] || e?.message || "오류가 발생했어요.";

function Section({ title, children }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      {children}
    </section>
  );
}

function StatusMsg({ ok, msg }) {
  if (!msg) return null;
  return <p className={`settings-msg ${ok ? "settings-msg--ok" : "settings-msg--err"}`}>{msg}</p>;
}

export default function SettingsPage({ user, onUserRefresh }) {
  const isEmailUser = user.providerData?.some(p => p.providerId === "password");
  const isGoogleUser = user.providerData?.some(p => p.providerId === "google.com");

  // 프로필
  const [name, setName] = useState(user.displayName || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState(null);

  // 비밀번호
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  // 이메일 인증
  const [verifySent, setVerifySent] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState(null);

  async function saveName(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setNameSaving(true); setNameMsg(null);
    try {
      await updateUserProfile(name);
      onUserRefresh?.();
      setNameMsg({ ok: true, text: "이름이 저장됐어요." });
    } catch (err) {
      setNameMsg({ ok: false, text: fmtErr(err) });
    } finally { setNameSaving(false); }
  }

  async function savePw(e) {
    e.preventDefault();
    if (newPw !== newPw2) { setPwMsg({ ok: false, text: "새 비밀번호가 일치하지 않아요." }); return; }
    if (newPw.length < 6)  { setPwMsg({ ok: false, text: "비밀번호는 6자 이상이어야 해요." }); return; }
    setPwSaving(true); setPwMsg(null);
    try {
      await changePassword(curPw, newPw);
      setCurPw(""); setNewPw(""); setNewPw2("");
      setPwMsg({ ok: true, text: "비밀번호가 변경됐어요." });
    } catch (err) {
      setPwMsg({ ok: false, text: fmtErr(err) });
    } finally { setPwSaving(false); }
  }

  async function sendVerify() {
    setVerifyMsg(null);
    try {
      await sendVerificationEmail();
      setVerifySent(true);
      setVerifyMsg({ ok: true, text: "인증 메일을 보냈어요. 받은 편지함을 확인해주세요." });
    } catch (err) {
      setVerifyMsg({ ok: false, text: fmtErr(err) });
    }
  }

  return (
    <div className="settings-wrap">

      {/* 프로필 */}
      <Section title="프로필">
        <div className="settings-avatar">
          {user.photoURL
            ? <img src={user.photoURL} alt="프로필" className="settings-avatar-img" referrerPolicy="no-referrer" />
            : <span className="settings-avatar-init">{(user.displayName || user.email || "?")[0].toUpperCase()}</span>
          }
          <div>
            <p className="settings-email">{user.email}</p>
            <p className="settings-provider">{isGoogleUser ? "Google 계정" : "이메일 계정"}</p>
          </div>
        </div>
        <form className="settings-form" onSubmit={saveName}>
          <label className="settings-label">표시 이름</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)}
            placeholder="표시될 이름" maxLength={40} />
          <button className="btn-primary" type="submit" disabled={nameSaving || !name.trim()}>
            {nameSaving ? "저장 중…" : "저장"}
          </button>
        </form>
        <StatusMsg ok={nameMsg?.ok} msg={nameMsg?.text} />
      </Section>

      {/* 이메일 인증 */}
      {isEmailUser && (
        <Section title="이메일 인증">
          {user.emailVerified ? (
            <p className="settings-verified">이메일이 인증됐어요.</p>
          ) : (
            <>
              <p className="settings-unverified">아직 이메일 인증이 완료되지 않았어요.</p>
              <button className="btn-secondary" onClick={sendVerify} disabled={verifySent}>
                {verifySent ? "메일 발송됨" : "인증 메일 보내기"}
              </button>
              <StatusMsg ok={verifyMsg?.ok} msg={verifyMsg?.text} />
            </>
          )}
        </Section>
      )}

      {/* 비밀번호 변경 */}
      {isEmailUser && (
        <Section title="비밀번호 변경">
          <form className="settings-form" onSubmit={savePw}>
            <label className="settings-label">현재 비밀번호</label>
            <input className="input" type="password" value={curPw}
              onChange={e => setCurPw(e.target.value)} autoComplete="current-password" />
            <label className="settings-label">새 비밀번호</label>
            <input className="input" type="password" value={newPw}
              onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
            <label className="settings-label">새 비밀번호 확인</label>
            <input className="input" type="password" value={newPw2}
              onChange={e => setNewPw2(e.target.value)} autoComplete="new-password" />
            <button className="btn-primary" type="submit"
              disabled={pwSaving || !curPw || !newPw || !newPw2}>
              {pwSaving ? "변경 중…" : "비밀번호 변경"}
            </button>
          </form>
          <StatusMsg ok={pwMsg?.ok} msg={pwMsg?.text} />
        </Section>
      )}

      {isGoogleUser && (
        <Section title="보안">
          <p className="settings-provider-note">
            Google 계정으로 로그인했어요. 비밀번호 관리는 Google 계정 설정에서 할 수 있어요.
          </p>
        </Section>
      )}
    </div>
  );
}
