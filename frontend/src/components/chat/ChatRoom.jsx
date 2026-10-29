import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch, BASE } from "../../api";
import { subscribeBroadcast, sendBroadcast } from "../../realtime/chatBus";

/*
 * 채팅방 공용 부품 — 채팅 페이지와 오른쪽 아래 작은 채팅창이 같이 쓴다.
 *  - 메시지의 링크는 눌러서 열 수 있게
 *  - 사진·파일 첨부 (📎 버튼, 붙여넣기, 끌어다 놓기)
 */

const MAX_UPLOAD = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

const clock = (iso) =>
  new Date(iso + (/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z"))
    .toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

const fileSize = (n) =>
  n == null ? "" : n < 1024 ? `${n}B` : n < 1048576 ? `${Math.round(n / 1024)}KB` : `${(n / 1048576).toFixed(1)}MB`;

// ── 링크 ─────────────────────────────────────────────────────────────────────

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const TRAILING = /[.,!?;:)\]}'"”’>]+$/;

/** 글 속 http(s)://, www. 주소를 눌러서 새 탭으로 열 수 있는 링크로 바꾼다. */
export function Linkified({ text }) {
  if (!text) return null;
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const tail = part.match(TRAILING)?.[0] || "";
    const url = tail ? part.slice(0, -tail.length) : part;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return (
      <span key={i}>
        <a className="chat-link" href={href} target="_blank" rel="noopener noreferrer nofollow">{url}</a>
        {tail}
      </span>
    );
  });
}

// ── 첨부 ─────────────────────────────────────────────────────────────────────

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

async function uploadChatFile(file) {
  const f = await shrinkImage(file);
  if (f.size > MAX_UPLOAD) throw new Error("파일은 10MB 이하만 보낼 수 있어요.");
  const form = new FormData();
  form.append("file", f);
  const res = await apiFetch("/notes/files", { method: "POST", body: form });
  return { url: res.url, name: file.name, type: res.content_type, size: res.size };
}

function AttachmentView({ att, onLoad }) {
  const href = BASE + att.url;
  if (IMAGE_TYPES.includes(att.type)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="chat-image-link" title="원본 보기">
        <img className="chat-image" src={href} alt={att.name || "사진"} loading="lazy" onLoad={onLoad} />
      </a>
    );
  }
  return (
    <a className="chat-file" href={href} target="_blank" rel="noopener noreferrer">
      <span className="chat-file-icon">{att.type === "application/pdf" ? "📄" : "📎"}</span>
      <span className="chat-file-info">
        <span className="chat-file-name">{att.name || "파일"}</span>
        <span className="chat-file-size">{fileSize(att.size)}</span>
      </span>
    </a>
  );
}

// ── 메시지 목록 ────────────────────────────────────────────────────────────────

function MessageList({ messages, me, emptyText, onDropFiles }) {
  const bottomRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const scroll = useCallback(() => bottomRef.current?.scrollIntoView({ block: "end" }), []);

  useEffect(() => { scroll(); }, [messages?.length, scroll]);

  return (
    <div className={`chat-messages ${dragging ? "chat-messages--drop" : ""}`}
      onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        setDragging(false);
        if (e.dataTransfer.files?.length) { e.preventDefault(); onDropFiles(e.dataTransfer.files[0]); }
      }}>
      {messages === null ? (
        <div className="loading-wrap"><div className="spinner" /></div>
      ) : messages.length === 0 ? (
        <p className="chat-empty">{emptyText}</p>
      ) : messages.map(m => {
        const mine = m.user_id === me.uid;
        const onlyImage = !m.content && m.attachment && IMAGE_TYPES.includes(m.attachment.type);
        return (
          <div key={m.id} className={`chat-msg ${mine ? "chat-msg--me" : ""}`}>
            <span className="chat-name">{mine ? "나" : m.display_name}</span>
            <span className={`chat-bubble ${onlyImage ? "chat-bubble--media" : ""}`}>
              {m.attachment && <AttachmentView att={m.attachment} onLoad={scroll} />}
              {m.content && <span className="chat-text"><Linkified text={m.content} /></span>}
            </span>
            <span className="chat-time">{clock(m.created_at)}</span>
          </div>
        );
      })}
      {dragging && <div className="chat-drop-hint">여기에 놓으면 파일을 보내요</div>}
      <div ref={bottomRef} />
    </div>
  );
}

// ── 입력창 ───────────────────────────────────────────────────────────────────

function Composer({ onSend, pickRef }) {
  const [text, setText] = useState("");
  const [att, setAtt] = useState(null); // { status: "uploading"|"ready"|"error", name, data?, error? }
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  const attach = useCallback(async (file) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD && !file.type.startsWith("image/")) {
      setAtt({ status: "error", name: file.name, error: "10MB 이하만 보낼 수 있어요" });
      return;
    }
    setAtt({ status: "uploading", name: file.name });
    try {
      const data = await uploadChatFile(file);
      setAtt({ status: "ready", name: file.name, data });
      inputRef.current?.focus();
    } catch (err) {
      setAtt({ status: "error", name: file.name, error: err.message });
    }
  }, []);

  // 목록 영역에 끌어다 놓은 파일도 여기로
  useEffect(() => { if (pickRef) pickRef.current = attach; }, [pickRef, attach]);

  async function send() {
    const content = text.trim();
    const attachment = att?.status === "ready" ? att.data : null;
    if ((!content && !attachment) || sending || att?.status === "uploading") return;
    setSending(true);
    try {
      await onSend({ content, attachment });
      setText("");
      setAtt(null);
    } catch { /* 입력 내용은 그대로 둬서 다시 보낼 수 있게 */ }
    finally { setSending(false); }
  }

  return (
    <div className="chat-composer">
      {att && (
        <div className={`chat-pending chat-pending--${att.status}`}>
          <span className="chat-pending-name">
            {att.status === "uploading" ? "올리는 중… " : att.status === "error" ? "⚠️ " : "📎 "}
            {att.name}{att.error ? ` — ${att.error}` : ""}
          </span>
          <button className="chat-pending-x" onClick={() => setAtt(null)} aria-label="첨부 취소">×</button>
        </div>
      )}
      <div className="chat-input-row">
        <button className="chat-attach" onClick={() => fileRef.current?.click()} title="사진·파일 첨부" aria-label="사진·파일 첨부">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
        </button>
        <input ref={fileRef} type="file" hidden
          onChange={e => { attach(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={inputRef} className="input chat-input" value={text} placeholder="메시지 입력…"
          onChange={e => setText(e.target.value)}
          onPaste={e => {
            const f = e.clipboardData?.files?.[0];
            if (f) { e.preventDefault(); attach(f); }
          }}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />
        <button className="btn-primary btn-sm" onClick={send}
          disabled={sending || att?.status === "uploading" || (!text.trim() && att?.status !== "ready")}>
          전송
        </button>
      </div>
    </div>
  );
}

// ── 대화방 데이터 + 실시간 ───────────────────────────────────────────────────

/**
 * kind: "dm" (id = DM 방 id) | "group" (id = 그룹 id)
 */
function useChatRoom({ kind, id, me, myName, other }) {
  const [messages, setMessages] = useState(null);
  const base = kind === "dm" ? `/chat/rooms/${id}/messages` : `/groups/${id}/messages`;
  const topic = kind === "dm" ? `dm:${id}` : `chat:${id}`;
  const event = kind === "dm" ? "dm-msg" : "chat-msg";

  const add = useCallback((m) => {
    setMessages(prev => (prev || []).some(x => x.id === m.id) ? prev : [...(prev || []), m]);
  }, []);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    apiFetch(base).then(d => alive && setMessages(d)).catch(() => alive && setMessages([]));
    return () => { alive = false; };
  }, [base]);

  useEffect(() => subscribeBroadcast(topic, event, add), [topic, event, add]);

  const send = useCallback(async ({ content, attachment }) => {
    const saved = await apiFetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, attachment, display_name: myName }),
    });
    add(saved);
    sendBroadcast(topic, event, saved);
    if (kind === "dm" && other?.uid) {
      const preview = content || (attachment?.type?.startsWith("image/") ? "📷 사진" : `📎 ${attachment?.name || "파일"}`);
      sendBroadcast(`inbox:${other.uid}`, "dm-notif", { from: myName, content: preview, room_id: id, from_uid: me.uid });
    }
    return saved;
  }, [base, topic, event, add, kind, other, myName, id, me.uid]);

  return { messages, send };
}

/** 대화방 하나 (헤더 + 메시지 + 입력창). compact = 오른쪽 아래 작은 창용 */
export default function ChatRoom({ kind, id, title, subtitle, me, myName, other, onBack, compact, emptyText }) {
  const { messages, send } = useChatRoom({ kind, id, me, myName, other });
  const pickRef = useRef(null);

  return (
    <div className={`chatapp-room ${compact ? "chatapp-room--compact" : ""}`}>
      <div className="chatapp-room-header">
        {onBack && <button className="btn-ghost chatapp-back" onClick={onBack} aria-label="뒤로">←</button>}
        <span className="chatapp-room-name">{title}</span>
        {subtitle && <span className="chatapp-room-sub">{subtitle}</span>}
      </div>
      <MessageList messages={messages} me={me}
        emptyText={emptyText || "첫 메시지를 보내보세요!"}
        onDropFiles={f => pickRef.current?.(f)} />
      <Composer onSend={send} pickRef={pickRef} />
    </div>
  );
}
