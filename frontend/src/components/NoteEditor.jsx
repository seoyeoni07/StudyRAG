import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration, yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import { ko } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { apiFetch, BASE } from "../api";
import { supabase } from "../supabase";
import { SupabaseYjsProvider, OfflineProvider, toB64 } from "../realtime/SupabaseYjsProvider";

/*
 * 개인 노트와 그룹 노트가 같이 쓰는 블록 에디터 (노션 방식).
 * - 내용은 Yjs 문서로 저장하고, 공유된 노트는 Supabase로 실시간 공동 편집
 * - 이미지·파일·영상·오디오 첨부 (붙여넣기, 끌어다 놓기, "/" 메뉴)
 * - 예전 마크다운 개인 노트는 처음 열 때 블록으로 한 번 옮긴다
 */

const COLORS = ["#e03e3e", "#d9730d", "#cb912f", "#0f7b6c", "#2383e2", "#6940a5", "#ad1a72"];
const colorFor = (uid = "") => COLORS[[...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const fromB64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

const MAX_UPLOAD = 10 * 1024 * 1024;

/** 큰 사진은 긴 변 1600px JPEG로 줄인다. GIF(움짤)와 작은 파일은 그대로 둔다. */
async function shrinkImage(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size <= 1024 * 1024) return file;
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

/** 에디터의 이미지·파일 업로드 → 백엔드(DB)에 저장하고 블록에 주소와 파일명을 넣는다. */
async function uploadNoteFile(file) {
  const f = file.type.startsWith("image/") ? await shrinkImage(file) : file;
  if (f.size > MAX_UPLOAD) throw new Error("첨부파일은 10MB 이하만 올릴 수 있어요.");
  const form = new FormData();
  form.append("file", f);
  const res = await apiFetch("/notes/files", { method: "POST", body: form });
  return { props: { url: BASE + res.url, name: file.name } };
}

/** 백엔드에서 스냅샷을 불러온 Y.Doc과 실시간 provider를 준비한다. */
export function useCollabDoc(noteId) {
  const [state, setState] = useState(null); // { doc, provider, meta }
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let doc, provider;
    setState(null); setError("");
    apiFetch(`/notes/${noteId}/ydoc`).then(meta => {
      if (cancelled) return;
      doc = new Y.Doc();
      if (meta.ydoc) Y.applyUpdate(doc, fromB64(meta.ydoc), "server");
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

function VersionPanel({ noteId, canRestore, onRestore, onClose }) {
  const [versions, setVersions] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    apiFetch(`/notes/${noteId}/versions`)
      .then(setVersions)
      .catch(err => { setMsg(err.message); setVersions([]); });
  }, [noteId]);

  async function restore(id) {
    setRestoring(id);
    try {
      await onRestore(await apiFetch(`/notes/${noteId}/versions/${id}`));
      setMsg("복원했어요. 마음에 안 들면 Ctrl+Z로 되돌릴 수 있어요.");
    } catch (err) { setMsg(err.message); }
    finally { setRestoring(null); }
  }

  return (
    <div className="version-panel">
      <div className="version-panel-header">
        <span>버전 기록</span>
        <button className="btn-ghost" onClick={onClose}>닫기</button>
      </div>
      {msg && <p className="version-msg">{msg}</p>}
      {!versions ? (
        <div className="loading-wrap"><div className="spinner" /></div>
      ) : versions.length === 0 ? (
        <p className="version-empty">저장된 버전이 없어요. 노트를 편집하면 5분 간격으로 자동 저장됩니다.</p>
      ) : (
        <ul className="version-list">
          {versions.map(v => (
            <li key={v.id} className="version-item">
              <span className="version-title">{v.title || "제목 없음"}</span>
              <span className="version-time">{new Date(v.created_at + "Z").toLocaleString("ko-KR")}</span>
              {canRestore && (
                <button className="btn-sm btn-secondary" disabled={restoring === v.id}
                  onClick={() => restore(v.id)}>{restoring === v.id ? "복원 중..." : "복원"}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * props
 *  - migrateMarkdown: 예전 마크다운 노트 내용 (Yjs 상태가 아직 없을 때만 넘긴다)
 *  - showVersions / canRestore / onCloseVersions: 버전 기록 패널
 *  - children: 제목과 본문 사이에 넣을 속성 영역 (연결된 자료, 태그 등)
 */
export default function NoteEditor({
  noteId, doc, provider, user, onSaved,
  migrateMarkdown, showVersions, canRestore, onCloseVersions, children,
}) {
  const name = user.displayName || user.email?.split("@")[0] || "멤버";
  const [title, setTitle] = useState(() => doc.getMap("meta").get("title") || "");
  const [peers, setPeers] = useState([]);
  const [connected, setConnected] = useState(provider.connected);
  const [saveState, setSaveState] = useState("saved");
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; });

  const editor = useCreateBlockNote(withCollaboration({
    dictionary: ko,
    uploadFile: uploadNoteFile,
    collaboration: {
      provider,
      fragment: doc.getXmlFragment("blocknote"),
      user: { name, color: colorFor(user.uid) },
      showCursorLabels: "activity",
    },
  }), [doc, provider]);

  // 예전 마크다운 노트 → 블록 (한 번만; meta.migrated 표시로 다른 탭·사람과 중복 방지)
  useEffect(() => {
    if (!migrateMarkdown?.trim()) return;
    const meta = doc.getMap("meta");
    return editor.onMount(() => {
      setTimeout(() => {
        if (meta.get("migrated")) return;
        meta.set("migrated", true);
        editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(migrateMarkdown));
      }, 0);
    });
  }, [editor, doc, migrateMarkdown]);

  // 사이드바에서 이름을 바꾸면 열려 있는 에디터 제목도 바꾼다 (같이 보는 사람에게도 전달됨)
  useEffect(() => {
    const fn = (e) => { if (e.detail?.id === noteId) doc.getMap("meta").set("title", e.detail.title); };
    window.addEventListener("studyrag:note-title", fn);
    return () => window.removeEventListener("studyrag:note-title", fn);
  }, [doc, noteId]);

  // 제목: Y.Map("meta")로 공유
  useEffect(() => {
    const m = doc.getMap("meta");
    const fn = () => setTitle(m.get("title") || "");
    m.observe(fn);
    return () => m.unobserve(fn);
  }, [doc]);

  // 같이 편집 중인 사람 (awareness)
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
      let content;
      try { content = editor.blocksToMarkdownLossy(editor.document); } catch { /* 검색용일 뿐 — 실패해도 저장은 진행 */ }
      try {
        const res = await apiFetch(`/notes/${noteId}/ydoc`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            update: toB64(Y.encodeStateAsUpdate(doc)),
            title: doc.getMap("meta").get("title") || "",
            content,
          }),
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
  }, [doc, provider, noteId, editor]);

  // 버전 복원 = 지금 문서를 그 버전 내용으로 '편집' — 같이 보는 사람에게도 그대로 반영된다
  async function restoreVersion(ver) {
    let blocks;
    if (ver.ydoc) {
      const tmp = new Y.Doc();
      Y.applyUpdate(tmp, fromB64(ver.ydoc));
      blocks = yXmlFragmentToBlocks(editor, tmp.getXmlFragment("blocknote"));
      tmp.destroy();
    } else {
      blocks = editor.tryParseMarkdownToBlocks(ver.content || "");
    }
    editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }]);
    doc.getMap("meta").set("title", ver.title || "");
  }

  const shared = peers.length > 0;

  return (
    <>
      <div className="collab-bar">
        {(shared || connected) && <span className={`collab-dot ${connected ? "on" : ""}`} />}
        {shared && <span className="collab-status">{peers.length}명과 함께 편집 중</span>}
        <span className="collab-save">
          {saveState === "saving" ? "저장 중…" : saveState === "dirty" ? "편집 중" : saveState === "error" ? "저장 실패 — 다시 시도합니다" : "저장됨"}
        </span>
        {shared && (
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
        )}
      </div>

      <input className="note-title" value={title} placeholder="제목 없음"
        onChange={e => doc.getMap("meta").set("title", e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); editor.focus(); }
        }} />

      {children}

      <div className="collab-editor">
        <BlockNoteView editor={editor} theme="light" />
      </div>

      {showVersions && (
        <VersionPanel noteId={noteId} canRestore={canRestore}
          onRestore={restoreVersion} onClose={onCloseVersions} />
      )}
    </>
  );
}
