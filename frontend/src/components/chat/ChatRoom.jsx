import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch, BASE } from "../../api";
import { subscribeBroadcast, sendBroadcast } from "../../realtime/chatBus";
import { registerOpenRoom, markDmRead, touchDmRoom } from "../../realtime/dmStore";
import { DocIcon, PaperclipIcon, WarningIcon } from "../Icons.jsx";

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
      <span className="chat-file-icon">{att.type === "application/pdf" ? <DocIcon size="1em" /> : <PaperclipIcon size="1em" />}</span>
      <span className="chat-file-info">
        <span className="chat-file-name">{att.name || "파일"}</span>
        <span className="chat-file-size">{fileSize(att.size)}</span>
      </span>
    </a>
  );
}

// ── 메시지 목록 ────────────────────────────────────────────────────────────────

const NEAR_BOTTOM = 120; // px — 이만큼 안쪽이면 '맨 아래를 보고 있는 중'으로 본다

/**
 * readInfo(m) → { label?, count? } : 읽음 표시 (DM: "읽음", 그룹: 안 읽은 사람 수)
 */
function MessageList({ messages, me, emptyText, onDropFiles, readInfo, onRetry, typingNames = [] }) {
  const boxRef = useRef(null);
  const stick = useRef(true);       // 맨 아래를 보고 있으면 새 메시지가 올 때 따라 내려간다
  const [dragging, setDragging] = useState(false);

  // 페이지 전체가 아니라 채팅 영역만 스크롤한다 (scrollIntoView는 바깥 페이지까지 같이 내렸다)
  const toBottom = useCallback(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const last = messages?.[messages.length - 1];
  useEffect(() => {
    if (!messages) return;
    // 내가 보낸 메시지거나, 이미 맨 아래를 보고 있었을 때만 내려간다 — 위쪽을 읽는 중이면 그대로 둔다
    if (stick.current || last?.user_id === me.uid) toBottom();
  }, [messages, last, me.uid, toBottom]);
  useEffect(() => { if (typingNames.length && stick.current) toBottom(); }, [typingNames.length, toBottom]);

  return (
    <div ref={boxRef} className={`chat-messages ${dragging ? "chat-messages--drop" : ""}`}
      onScroll={e => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
      }}
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
        const read = !m.pending && !m.failed ? readInfo?.(m) : null;
        return (
          <div key={m.key || m.id} className={`chat-msg ${mine ? "chat-msg--me" : ""} ${m.pending && mine ? "chat-msg--pending" : ""}`}>
            <span className="chat-name">{mine ? "나" : m.display_name}</span>
            <span className={`chat-bubble ${onlyImage ? "chat-bubble--media" : ""}`}>
              {m.attachment && <AttachmentView att={m.attachment} onLoad={() => stick.current && toBottom()} />}
              {m.content && <span className="chat-text"><Linkified text={m.content} /></span>}
            </span>
            <span className="chat-meta">
              {read?.count > 0 && <span className="chat-unread-count">{read.count}</span>}
              {read?.label && <span className="chat-read">{read.label}</span>}
              {m.failed ? (
                <button className="chat-retry" onClick={() => onRetry(m)}>전송 실패 · 다시 보내기</button>
              ) : (
                <span className="chat-time">{m.pending && mine ? "보내는 중" : clock(m.created_at)}</span>
              )}
            </span>
          </div>
        );
      })}
      {typingNames.length > 0 && (
        <div className="chat-typing" aria-live="polite">
          <span className="chat-typing-dots"><span /><span /><span /></span>
          {typingNames.length === 1 ? `${typingNames[0]}님이 입력 중…` : `${typingNames.length}명이 입력 중…`}
        </div>
      )}
      {dragging && <div className="chat-drop-hint">여기에 놓으면 파일을 보내요</div>}
    </div>
  );
}

// ── 입력창 ───────────────────────────────────────────────────────────────────

function Composer({ onSend, pickRef, onTyping }) {
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
    // 보내자마자 화면에 뜨고(보내는 중), 실패하면 메시지 옆에 '다시 보내기'가 나온다
    setText("");
    setAtt(null);
    onTyping?.(false);
    try { await onSend({ content, attachment }); }
    finally { setSending(false); }
  }

  return (
    <div className="chat-composer">
      {att && (
        <div className={`chat-pending chat-pending--${att.status}`}>
          <span className="chat-pending-name">
            {att.status === "uploading" ? "올리는 중… " : att.status === "error" ? <><WarningIcon size="0.9em" /> </> : <><PaperclipIcon size="0.9em" /> </>}
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
          onChange={e => { setText(e.target.value); onTyping?.(!!e.target.value.trim()); }}
          onBlur={() => onTyping?.(false)}
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

const newKey = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * kind: "dm" (id = DM 방 id) | "group" (id = 그룹 id)
 *
 * 빠르게 보이게:
 *  1) 보내면 내 화면에 바로 띄우고(보내는 중), 상대에게도 실시간 채널로 바로 보낸다
 *  2) 서버 저장이 끝나면 "saved"로 진짜 id를 알려 같은 메시지로 바꿔 끼운다
 *  3) 저장 실패면 "failed"로 상대 화면에서 지우고, 내 화면엔 '다시 보내기'
 */
function useChatRoom({ kind, id, me, myName, other }) {
  const [messages, setMessages] = useState(null);
  const [reads, setReads] = useState({}); // user_id → 어디까지 읽었는지(메시지 id)
  const base = kind === "dm" ? `/chat/rooms/${id}/messages` : `/groups/${id}/messages`;
  const readBase = kind === "dm" ? `/chat/rooms/${id}` : `/groups/${id}/messages`;
  const topic = kind === "dm" ? `dm:${id}` : `chat:${id}`;
  const ev = kind === "dm" ? "dm" : "chat";

  const upsert = useCallback((m) => {
    setMessages(prev => {
      const list = prev || [];
      if (m.id != null && list.some(x => x.id === m.id)) {
        // 이미 진짜 메시지가 있으면 같은 key의 임시 메시지만 정리
        return m.key ? list.filter(x => !(x.key === m.key && x.id !== m.id)) : list;
      }
      const i = m.key ? list.findIndex(x => x.key === m.key) : -1;
      if (i >= 0) { const next = [...list]; next[i] = { ...list[i], ...m }; return next; }
      if (m.content == null && !m.attachment) return list; // 내용 없는 상태 갱신이 먼저 도착한 경우
      return [...list, m];
    });
  }, []);
  const drop = useCallback((key) => setMessages(prev => (prev || []).filter(x => x.key !== key || x.id != null)), []);

  // 처음 불러오기: 메시지 + 읽음 위치
  useEffect(() => {
    let alive = true;
    setMessages(null); setReads({});
    apiFetch(base).then(d => alive && setMessages(d)).catch(() => alive && setMessages([]));
    apiFetch(`${readBase}/reads`)
      .then(rows => alive && setReads(Object.fromEntries(rows.map(r => [r.user_id, r.last_read_id]))))
      .catch(() => {});
    return () => { alive = false; };
  }, [base, readBase]);

  // 실시간: 새 메시지(임시) / 저장 완료 / 실패 / 읽음
  // '저장 완료'가 메시지보다 먼저 도착하는 드문 경우를 위해 잠깐 기억해 둔다
  const savedEarly = useRef({});
  useEffect(() => {
    const offs = [
      subscribeBroadcast(topic, `${ev}-msg`, (m) => {  // 예전 버전이 보내는 저장된 메시지도 여기로 온다
        const early = m.key && savedEarly.current[m.key];
        if (early) delete savedEarly.current[m.key];
        upsert(early ? { ...m, ...early, pending: false } : m);
      }),
      subscribeBroadcast(topic, `${ev}-saved`, ({ key, id: realId, created_at }) => {
        setMessages(prev => {
          if (!(prev || []).some(x => x.key === key)) savedEarly.current[key] = { id: realId, created_at };
          return prev;
        });
        upsert({ key, id: realId, created_at, pending: false });
      }),
      subscribeBroadcast(topic, `${ev}-failed`, ({ key }) => drop(key)),
      subscribeBroadcast(topic, `${ev}-read`, ({ user_id, last_id }) =>
        setReads(r => (r[user_id] || 0) >= last_id ? r : { ...r, [user_id]: last_id })),
    ];
    return () => offs.forEach(off => off());
  }, [topic, ev, upsert, drop]);

  // 내가 이 방을 보고 있으면 읽음 처리 (탭이 보일 때만)
  const lastOther = messages?.filter(m => m.id != null && m.user_id !== me.uid).at(-1)?.id;
  const myRead = reads[me.uid] || 0;
  useEffect(() => {
    if (!lastOther || lastOther <= myRead) return;
    const run = () => {
      if (document.visibilityState !== "visible") return;
      setReads(r => ({ ...r, [me.uid]: lastOther }));
      if (kind === "dm") markDmRead(id);
      apiFetch(`${readBase}/read`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_id: lastOther }),
      }).then(() => kind === "dm" && markDmRead(id)).catch(() => {});
      sendBroadcast(topic, `${ev}-read`, { user_id: me.uid, last_id: lastOther });
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, [lastOther, myRead, readBase, topic, ev, me.uid, kind, id]);

  // 이 DM 방이 화면에 열려 있는 동안 등록 — 이 방 메시지로는 알림(토스트)·배지를 띄우지 않는다
  useEffect(() => (kind === "dm" ? registerOpenRoom(id) : undefined), [kind, id]);

  // ── 입력 중 표시 ──
  const [typing, setTyping] = useState({}); // user_id → { name, until }
  useEffect(() => subscribeBroadcast(topic, `${ev}-typing`, ({ user_id, name, stop }) => {
    if (user_id === me.uid) return;
    setTyping(t => {
      const next = { ...t };
      if (stop) delete next[user_id]; else next[user_id] = { name, until: Date.now() + 4000 };
      return next;
    });
  }), [topic, ev, me.uid]);
  // 메시지가 오면 그 사람의 '입력 중'은 끝
  const lastSender = messages?.at(-1)?.user_id;
  useEffect(() => {
    if (!lastSender) return;
    setTyping(t => {
      if (!t[lastSender]) return t;
      const next = { ...t };
      delete next[lastSender];
      return next;
    });
  }, [messages?.length, lastSender]);
  // 신호가 끊기면(창을 닫는 등) 4초 뒤 사라지게
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const t = setInterval(() => setTyping(cur => {
      const now = Date.now();
      const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
      return Object.keys(next).length === Object.keys(cur).length ? cur : next;
    }), 1000);
    return () => clearInterval(t);
  }, [typing]);
  const lastTypingSent = useRef(0);
  const notifyTyping = useCallback((active) => {
    const now = Date.now();
    if (active && now - lastTypingSent.current < 2000) return; // 2초에 한 번만
    if (!active && !lastTypingSent.current) return;           // 입력 중이라고 알린 적 없으면 '멈춤'도 안 보낸다
    lastTypingSent.current = active ? now : 0;
    sendBroadcast(topic, `${ev}-typing`, { user_id: me.uid, name: myName, stop: !active });
  }, [topic, ev, me.uid, myName]);
  const typingNames = Object.values(typing).map(v => v.name);

  const deliver = useCallback(async (msg) => {
    const { key, content, attachment } = msg;
    try {
      const saved = await apiFetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, attachment, display_name: myName }),
      });
      upsert({ ...saved, key, pending: false, failed: false });
      sendBroadcast(topic, `${ev}-saved`, { key, id: saved.id, created_at: saved.created_at });
      if (kind === "dm") {
        touchDmRoom(id, {
          last_message: content || (attachment?.type?.startsWith("image/") ? "📷 사진" : `📎 ${attachment?.name || "파일"}`),
          last_at: saved.created_at,
        });
      }
      if (kind === "dm" && other?.uid) {
        const preview = content || (attachment?.type?.startsWith("image/") ? "📷 사진" : `📎 ${attachment?.name || "파일"}`);
        sendBroadcast(`inbox:${other.uid}`, "dm-notif", { from: myName, content: preview, room_id: id, from_uid: me.uid });
      }
    } catch {
      upsert({ key, pending: false, failed: true });
      sendBroadcast(topic, `${ev}-failed`, { key });
    }
  }, [base, myName, upsert, topic, ev, kind, other, id, me.uid]);

  const send = useCallback(({ content, attachment }) => {
    const msg = {
      key: newKey(), id: null, user_id: me.uid, display_name: myName,
      content, attachment, created_at: new Date().toISOString(), pending: true,
    };
    upsert(msg);
    // 저장을 기다리지 않고 상대에게 먼저 보낸다
    sendBroadcast(topic, `${ev}-msg`, msg);
    return deliver(msg);
  }, [me.uid, myName, upsert, topic, ev, deliver]);

  const retry = useCallback((m) => {
    upsert({ key: m.key, pending: true, failed: false });
    sendBroadcast(topic, `${ev}-msg`, { ...m, pending: true, failed: false });
    deliver(m);
  }, [upsert, topic, ev, deliver]);

  return { messages, reads, send, retry, typingNames, notifyTyping };
}

/** 대화방 하나 (헤더 + 메시지 + 입력창). compact = 오른쪽 아래 작은 창용 */
export default function ChatRoom({ kind, id, title, subtitle, me, myName, other, memberIds, onBack, compact, emptyText }) {
  const { messages, reads, send, retry, typingNames, notifyTyping } = useChatRoom({ kind, id, me, myName, other });
  const pickRef = useRef(null);

  // DM: 상대가 읽은 내 메시지 중 가장 마지막 것에만 "읽음"
  // 그룹: 메시지마다 아직 안 읽은 사람 수 (보낸 사람 제외)
  const lastReadMine = kind === "dm" && other?.uid
    ? messages?.filter(m => m.user_id === me.uid && m.id != null && m.id <= (reads[other.uid] || 0)).at(-1)?.id
    : null;
  const readInfo = (m) => {
    if (m.id == null) return null;
    if (kind === "dm") return m.id === lastReadMine ? { label: "읽음" } : null;
    if (!memberIds?.length) return null;
    const unread = memberIds.filter(uid => uid !== m.user_id && (reads[uid] || 0) < m.id).length;
    return unread > 0 ? { count: unread } : null;
  };

  return (
    <div className={`chatapp-room ${compact ? "chatapp-room--compact" : ""}`}>
      <div className="chatapp-room-header">
        {onBack && <button className="btn-ghost chatapp-back" onClick={onBack} aria-label="뒤로">←</button>}
        <span className="chatapp-room-name">{title}</span>
        {subtitle && <span className="chatapp-room-sub">{subtitle}</span>}
      </div>
      <MessageList messages={messages} me={me}
        emptyText={emptyText || "첫 메시지를 보내보세요!"}
        readInfo={readInfo} onRetry={retry} typingNames={typingNames}
        onDropFiles={f => pickRef.current?.(f)} />
      <Composer onSend={send} pickRef={pickRef} onTyping={notifyTyping} />
    </div>
  );
}
