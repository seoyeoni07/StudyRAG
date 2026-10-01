import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration } from "@blocknote/core/yjs";
import { ko } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { apiFetch, BASE } from "../api";
import { supabase } from "../supabase";
import { SupabaseYjsProvider, OfflineProvider, toB64 } from "../realtime/SupabaseYjsProvider";

const COLORS = ["#e03e3e", "#d9730d", "#cb912f", "#0f7b6c", "#2383e2", "#6940a5", "#ad1a72"];
const colorFor = (uid = "") => COLORS[[...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

const MAX_UPLOAD = 5 * 1024 * 1024;

/** 큰 사진은 긴 변 1600px JPEG로 줄인다. GIF(움짤)와 작은 파일은 그대로 둔다. */
async function shrinkImage(file) {
  if (file.type === "image/gif" || file.size <= 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size
      ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" })
      : file;
  } catch {
    return file;
  }
}

/** BlockNote 이미지 블록·붙여넣기·드래그 업로드 → 백엔드에 저장하고 주소를 돌려준다. */
async function uploadImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있어요.");
  const small = await shrinkImage(file);
  if (small.size > MAX_UPLOAD) throw new Error("이미지는 5MB 이하만 올릴 수 있어요.");
  const form = new FormData();
  form.append("file", small);
  const res = await apiFetch("/notes/images", { method: "POST", body: form });
  return BASE + res.url;
}

/** 백엔드에서 스냅샷을 불러온 Y.Doc과 실시간 provider를 준비한다. */
function useCollabDoc(noteId) {
  const [state, setState] = useState(null); // { doc, provider, meta }
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let doc, provider;
    setState(null); setError("");
    apiFetch(`/notes/${noteId}/ydoc`).then(meta => {
      if (cancelled) return;
      doc = new Y.Doc();
      if (meta.ydoc) Y.applyUpdate(doc, Uint8Array.from(atob(meta.ydoc), c => c.charCodeAt(0)), "server");
      const m = doc.getMap("meta");
      if (!m.has("title") && meta.title) m.set("title", meta.title);
      provider = supabase
        ? new SupabaseYjsProvider(supabase, `note:${noteId}`, doc)
        : new OfflineProvider(doc);
      setState({ doc, provider, meta });
    }).catch(err => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      // 에디터 쪽 정리(마지막 저장)가 먼저 끝나도록 한 틱 뒤에 정리
      setTimeout(() => { provider?.destroy(); doc?.destroy(); }, 0);
    };
  }, [noteId]);

  return { state, error };
}

function Editor({ noteId, doc, provider, user, onSaved }) {
  const name = user.displayName || user.email?.split("@")[0] || "멤버";
  const [title, setTitle] = useState(() => doc.getMap("meta").get("title") || "");
  const [peers, setPeers] = useState([]);
  const [connected, setConnected] = useState(provider.connected);
  const [saveState, setSaveState] = useState("saved");
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const editor = useCreateBlockNote(withCollaboration({
    dictionary: ko,
    uploadFile: uploadImage,
    collaboration: {
      provider,
      fragment: doc.getXmlFragment("blocknote"),
      user: { name, color: colorFor(user.uid) },
      showCursorLabels: "activity",
    },
  }), [doc, provider]);

  // 제목: Y.Map("meta")로 공유
  useEffect(() => {
    const m = doc.getMap("meta");
    const fn = () => setTitle(m.get("title") || "");
    m.observe(fn);
    return () => m.unobserve(fn);
  }, [doc]);

  // 접속자 목록 (awareness)
  useEffect(() => {
    const aw = provider.awareness;
    const fn = () => {
      const list = [];
      aw.getStates().forEach((st, clientId) => {
        if (clientId !== doc.clientID && st.user) list.push({ clientId, ...st.user });
      });
      setPeers(list);
    };
    aw.on("change", fn); fn();
    const off = provider.onStatus(setConnected);
    return () => { aw.off("change", fn); off(); };
  }, [doc, provider]);

  // 내 수정만 저장 — 다른 사람 수정은 그 사람이 저장한다. 서버는 상태를 합친다(merge).
  useEffect(() => {
    async function save() {
      clearTimeout(saveTimer.current);
      if (!dirty.current) return;
      dirty.current = false;
      setSaveState("saving");
      try {
        const res = await apiFetch(`/notes/${noteId}/ydoc`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ update: toB64(Y.encodeStateAsUpdate(doc)), title: doc.getMap("meta").get("title") || "" }),
        });
        setSaveState(dirty.current ? "dirty" : "saved");
        onSavedRef.current?.(res);
      } catch {
        dirty.current = true;
        setSaveState("error");
      }
    }
    const onUpdate = (_u, origin) => {
      if (origin === provider || origin === "server") return;
      dirty.current = true;
      setSaveState("dirty");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(save, 1500);
    };
    doc.on("update", onUpdate);
    return () => { doc.off("update", onUpdate); save(); };
  }, [doc, provider, noteId]);

  return (
    <>
      <div className="collab-bar">
        <span className={`collab-dot ${connected ? "on" : ""}`} />
        <span className="collab-status">
          {!supabase ? "실시간 미연결 (저장만 됨)" : connected ? "실시간 연결됨" : "연결 중…"}
        </span>
        <span className="collab-save">
          {saveState === "saving" ? "저장 중…" : saveState === "dirty" ? "편집 중" : saveState === "error" ? "저장 실패 — 다시 시도합니다" : "저장됨"}
        </span>
        <div className="collab-peers">
          {peers.map(p => (
            <span key={p.clientId} className="collab-peer" style={{ background: p.color }} title={`${p.name} 편집 중`}>
              {p.name.slice(0, 1)}
            </span>
          ))}
          <span className="collab-peer collab-peer--me" style={{ background: colorFor(user.uid) }} title={`${name} (나)`}>
            {name.slice(0, 1)}
          </span>
        </div>
      </div>

      <input className="note-title" value={title} placeholder="제목 없음"
        onChange={e => doc.getMap("meta").set("title", e.target.value)} />

      <div className="collab-editor">
        <BlockNoteView editor={editor} theme="light" />
      </div>
    </>
  );
}

export default function GroupNotePage({ noteId, user, group, onSaved, onDeleted }) {
  const { state, error } = useCollabDoc(noteId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delError, setDelError] = useState("");

  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!state) return <div className="loading-wrap"><div className="spinner" /></div>;

  const { meta } = state;
  const canDelete = meta.user_id === user.uid || group?.my_role === "owner";

  async function handleDelete() {
    try {
      await apiFetch(`/notes/${noteId}`, { method: "DELETE" });
      onDeleted?.(noteId);
    } catch (err) { setDelError(err.message); }
  }

  return (
    <div className="note-page">
      <div className="page-icon">{meta.icon || "📄"}</div>
      <Editor noteId={noteId} doc={state.doc} provider={state.provider} user={user} onSaved={onSaved} />

      {delError && <div className="error-banner"><span>{delError}</span></div>}
      {canDelete && (
        <div className="note-footer">
          {confirmDelete ? (
            <>
              <span className="note-footer-text">그룹 멤버 모두에게서 이 노트가 삭제돼요. 삭제할까요?</span>
              <button className="btn-danger" onClick={handleDelete}>삭제</button>
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>취소</button>
            </>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmDelete(true)}>노트 삭제</button>
          )}
        </div>
      )}
    </div>
  );
}
