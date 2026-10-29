import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import NoteEditor, { useCollabDoc } from "./NoteEditor";

const ICONS = ["📝", "📒", "📘", "📗", "📙", "💡", "⭐", "🔖", "🧠", "📌", "✏️", "🎯"];

function ShareModal({ noteId, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [shares, setShares] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    apiFetch(`/notes/${noteId}/shares`)
      .then(setShares)
      .catch(err => { setMsg(err.message); setShares([]); });
  }, [noteId]);

  async function search() {
    if (q.length < 2) return;
    setBusy(true);
    try {
      const data = await apiFetch(`/users/search?q=${encodeURIComponent(q)}`);
      setResults(data);
    } catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  }

  async function share(uid) {
    try {
      await apiFetch(`/notes/${noteId}/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: uid }) });
      const fresh = await apiFetch(`/notes/${noteId}/shares`);
      setShares(fresh);
      setResults(r => r.filter(u => u.uid !== uid));
      setMsg("공유했어요.");
    } catch (err) { setMsg(err.message); }
  }

  async function unshare(uid) {
    try {
      await apiFetch(`/notes/${noteId}/shares/${uid}`, { method: "DELETE" });
      setShares(s => s.filter(u => u.uid !== uid));
    } catch (err) { setMsg(err.message); }
  }

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <div className="share-modal-header">
          <span>노트 공유</span>
          <button className="btn-ghost" onClick={onClose}>닫기</button>
        </div>
        {msg && <p className="share-msg">{msg}</p>}
        <div className="share-search-row">
          <input className="input" value={q} placeholder="이메일 또는 이름으로 검색 (2자 이상)"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()} />
          <button className="btn-secondary btn-sm" onClick={search} disabled={busy || q.length < 2}>검색</button>
        </div>
        {results.length > 0 && (
          <ul className="share-results">
            {results.map(u => (
              <li key={u.uid} className="share-result-item">
                <span className="share-result-name">{u.display_name || u.email}</span>
                <span className="share-result-email">{u.email}</span>
                <button className="btn-sm btn-primary" onClick={() => share(u.uid)}>공유</button>
              </li>
            ))}
          </ul>
        )}
        {shares === null ? (
          <div className="loading-wrap"><div className="spinner" /></div>
        ) : shares.length > 0 && (
          <div className="share-current">
            <p className="share-current-title">공유 중</p>
            {shares.map(u => (
              <div key={u.uid} className="share-current-item">
                <span>{u.display_name || u.email}</span>
                <button className="btn-ghost btn-sm" onClick={() => unshare(u.uid)}>해제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NotePage({ noteId, user, pastDocs, onChanged, onDeleted, onOpenDoc }) {
  const { state, error: loadError } = useCollabDoc(noteId);
  const [props, setProps] = useState(null); // 아이콘·연결된 자료·태그 등 (본문·제목은 에디터가 관리)
  const [error, setError] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    if (state?.meta) setProps(state.meta);
  }, [state?.meta]);

  // 아이콘·연결된 자료·태그는 바로 저장
  async function update(fields) {
    setProps(p => ({ ...p, ...fields }));
    try {
      const saved = await apiFetch(`/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      onChanged?.(saved);
    } catch (err) { setError(err.message); }
  }

  async function handleDelete() {
    try {
      await apiFetch(`/notes/${noteId}`, { method: "DELETE" });
      onDeleted?.(noteId);
    } catch (err) { setError(err.message); }
  }

  if (loadError) return <div className="error-banner"><span>{loadError}</span></div>;
  if (!state || !props) return <div className="loading-wrap"><div className="spinner" /></div>;

  const isOwner = user && props.user_id === user.uid;
  const linkedDoc = pastDocs.find(d => d.doc_id === props.doc_id);

  return (
    <div className="note-page">
      <div className="note-icon-wrap">
        <button className="note-icon" onClick={() => setIconOpen(o => !o)} title="아이콘 변경">
          {props.icon || "📝"}
        </button>
        {iconOpen && (
          <div className="note-icon-picker" role="listbox">
            {ICONS.map(ic => (
              <button key={ic} className="note-icon-option"
                onClick={() => { update({ icon: ic }); setIconOpen(false); }}>{ic}</button>
            ))}
          </div>
        )}
      </div>

      <NoteEditor noteId={noteId} doc={state.doc} provider={state.provider} user={user}
        onSaved={saved => onChanged?.(saved)}
        migrateMarkdown={isOwner ? state.meta.legacy_markdown : null}
        showVersions={showVersions} canRestore={isOwner}
        onCloseVersions={() => setShowVersions(false)}>
        <div className="note-props">
          <div className="note-prop">
            <span className="note-prop-key">연결된 자료</span>
            <select className="note-prop-select" value={props.doc_id || ""}
              onChange={e => update({ doc_id: e.target.value || null })}>
              <option value="">없음</option>
              {pastDocs.map(d => <option key={d.doc_id} value={d.doc_id}>{d.filename}</option>)}
            </select>
            {linkedDoc && (
              <button className="note-prop-link" onClick={() => onOpenDoc?.(linkedDoc.doc_id, linkedDoc.filename)}>열기 ↗</button>
            )}
          </div>
          <div className="note-prop">
            <span className="note-prop-key">태그</span>
            <div className="note-tags-wrap">
              {(props.tags || []).map(t => (
                <span key={t} className="note-tag">
                  {t}
                  <button className="note-tag-del" onClick={() => update({ tags: (props.tags || []).filter(x => x !== t) })}>×</button>
                </span>
              ))}
              <input className="note-tag-input" placeholder="태그 추가…" maxLength={32}
                onKeyDown={e => {
                  if ((e.key === "Enter" || e.key === ",") && e.target.value.trim()) {
                    e.preventDefault();
                    const t = e.target.value.trim().replace(/,/g, "");
                    if (t && !(props.tags || []).includes(t)) update({ tags: [...(props.tags || []), t] });
                    e.target.value = "";
                  }
                }} />
            </div>
          </div>
        </div>
      </NoteEditor>

      {error && <div className="error-banner"><span>{error}</span></div>}
      {showShare && <ShareModal noteId={noteId} onClose={() => setShowShare(false)} />}

      <div className="note-footer">
        <button className="btn-ghost" onClick={() => setShowVersions(v => !v)}>버전 기록</button>
        {isOwner && <button className="btn-ghost" onClick={() => setShowShare(true)}>공유</button>}
        <button className="btn-ghost" onClick={() => window.print()}>PDF 저장</button>
        {isOwner && (confirmDelete ? (
          <>
            <span className="note-footer-text">이 노트를 삭제할까요?</span>
            <button className="btn-danger" onClick={handleDelete}>삭제</button>
            <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>취소</button>
          </>
        ) : (
          <button className="btn-ghost" onClick={() => setConfirmDelete(true)}>노트 삭제</button>
        ))}
      </div>
    </div>
  );
}
