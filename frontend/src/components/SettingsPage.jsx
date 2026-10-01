import { useState, useRef } from "react";
import { auth, updateUserProfile, changePassword } from "../firebase";
import { apiFetch, BASE } from "../api";

const FIREBASE_ERRORS = {
  "auth/wrong-password":        "현재 비밀번호가 틀렸어요.",
  "auth/invalid-credential":    "현재 비밀번호가 틀렸어요.",
  "auth/weak-password":         "비밀번호는 6자 이상이어야 해요.",
  "auth/too-many-requests":     "요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
  "auth/requires-recent-login": "보안을 위해 다시 로그인 후 시도해주세요.",
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
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileRef = useRef();

  // 비밀번호
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 미리보기
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(file);
    // 업로드
    setAvatarUploading(true);
    setNameMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { url } = await apiFetch("/notes/images", { method: "POST", body: form });
      const photoURL = (BASE || "") + url;
      await updateUserProfile(auth.currentUser.displayName || name, photoURL);
      onUserRefresh?.();
      setNameMsg({ ok: true, text: "프로필 사진이 변경됐어요." });
    } catch (err) {
      setNameMsg({ ok: false, text: fmtErr(err) });
      setAvatarPreview(null);
    } finally { setAvatarUploading(false); }
  }

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

  const avatarSrc = avatarPreview || user.photoURL;

  return (
    <div className="settings-wrap">

      {/* 프로필 */}
      <Section title="프로필">
        {/* 프로필 사진 */}
        <div className="settings-avatar-edit">
          <div className="settings-avatar-wrap" onClick={() => fileRef.current?.click()}
            title="클릭해서 사진 변경" role="button" aria-label="프로필 사진 변경">
            {avatarSrc
              ? <img src={avatarSrc} alt="프로필" className="settings-avatar-img" referrerPolicy="no-referrer" />
              : <span className="settings-avatar-init">{(user.displayName || user.email || "?")[0].toUpperCase()}</span>
            }
            <span className="settings-avatar-overlay">
              {avatarUploading ? <span className="spinner spinner-sm" /> : "✎"}
            </span>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
            hidden onChange={handleAvatarChange} />
          <div>
            <p className="settings-email">{user.email}</p>
            <p className="settings-provider">{isGoogleUser ? "Google 계정" : "이메일 계정"}</p>
            <p className="settings-avatar-hint">프로필 사진을 클릭해서 변경</p>
          </div>
        </div>

        {/* 표시 이름 */}
        <form className="settings-form" onSubmit={saveName} style={{ marginTop: 16 }}>
          <label className="settings-label">표시 이름</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)}
            placeholder="표시될 이름" maxLength={40} />
          <button className="btn-primary" type="submit" disabled={nameSaving || !name.trim()}>
            {nameSaving ? "저장 중…" : "저장"}
          </button>
        </form>
        <StatusMsg ok={nameMsg?.ok} msg={nameMsg?.text} />
      </Section>

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
