import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import NoteEditor, { useCollabDoc } from "./NoteEditor";
import { SubPages } from "./NoteTree";

export default function GroupNotePage({ noteId, user, group, onSaved, onDeleted, subpages, onOpenNote, onAddSubpage }) {
  const { state, error } = useCollabDoc(noteId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delError, setDelError] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [versionsPublic, setVersionsPublic] = useState(null); // null = 로드 전

  // meta에서 versions_public 초기값 세팅
  useEffect(() => {
    if (state?.meta?.versions_public !== undefined) {
      setVersionsPublic(state.meta.versions_public);
    }
  }, [state?.meta?.versions_public]);

  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!state) return <div className="loading-wrap"><div className="spinner" /></div>;

  const { meta } = state;
  const isCreator = meta.user_id === user.uid;
  const isOwner = group?.my_role === "owner";
  const canManage = isCreator || isOwner;      // 작성자·그룹장
  const canSeeVersions = canManage || versionsPublic;

  async function handleDelete() {
    try {
      await apiFetch(`/notes/${noteId}`, { method: "DELETE" });
      onDeleted?.(noteId);
    } catch (err) { setDelError(err.message); }
  }

  async function toggleVersionsPublic() {
    const next = !versionsPublic;
    try {
      await apiFetch(`/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versions_public: next }),
      });
      setVersionsPublic(next);
    } catch (err) { setDelError(err.message); }
  }

  return (
    <div className="note-page">
      <div className="page-icon">{meta.icon || "📄"}</div>
      <NoteEditor noteId={noteId} doc={state.doc} provider={state.provider} user={user} onSaved={onSaved}
        showVersions={showVersions && canSeeVersions} canRestore={canManage}
        onCloseVersions={() => setShowVersions(false)} />

      <SubPages items={subpages || []} defaultIcon="📄" onOpen={id => onOpenNote?.(id)} onAdd={() => onAddSubpage?.()} />

      {delError && <div className="error-banner"><span>{delError}</span></div>}
      <div className="note-footer">
        {canSeeVersions && (
          <button className="btn-ghost" onClick={() => setShowVersions(v => !v)}>버전 기록</button>
        )}
        {canManage && versionsPublic !== null && (
          <label className="version-public-toggle">
            <input type="checkbox" checked={versionsPublic} onChange={toggleVersionsPublic} />
            <span>멤버에게 버전 기록 공개</span>
          </label>
        )}
        {canManage && (
          confirmDelete ? (
            <>
              <span className="note-footer-text">
                그룹 멤버 모두에게서 이 노트{subpages?.length ? "와 하위 페이지가" : "가"} 삭제돼요. 삭제할까요?
              </span>
              <button className="btn-danger" onClick={handleDelete}>삭제</button>
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>취소</button>
            </>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmDelete(true)}>노트 삭제</button>
          )
        )}
      </div>
    </div>
  );
}
