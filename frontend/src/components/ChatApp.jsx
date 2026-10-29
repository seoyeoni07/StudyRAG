import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api.js";
import { supabase } from "../supabase.js";

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

// ── DM 채팅창 ─────────────────────────────────────────────────────────────────

function DmChat({ roomId, other, me, onBack }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const myName = me.displayName || me.email?.split("@")[0] || "나";

  useEffect(() => {
    setMessages(null);
    apiFetch(`/chat/rooms/${roomId}/messages`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [roomId]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`dm:${roomId}`, { config: { broadcast: { self: false } } });
    channelRef.current = ch;
    ch.on("broadcast", { event: "dm-msg" }, ({ payload }) => {
      setMessages(prev => prev ? [...prev, payload] : [payload]);
    }).subscribe();
    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      const saved = await apiFetch(`/chat/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, display_name: myName }),
      });
      setMessages(prev => prev ? [...prev, saved] : [saved]);
      channelRef.current?.send({ type: "broadcast", event: "dm-msg", payload: saved }).catch(() => {});
      // 상대방 inbox 알림
      if (supabase && other?.uid) {
        supabase.channel(`inbox:${other.uid}`).send({
          type: "broadcast", event: "dm-notif",
          payload: { from: myName, content, room_id: roomId },
        }).catch(() => {});
      }
    } catch { setText(content); }
    finally { setSending(false); }
  }

  return (
    <div className="chatapp-room">
      <div className="chatapp-room-header">
        <button className="btn-ghost chatapp-back" onClick={onBack}>←</button>
        <span className="chatapp-room-name">{other?.display_name || other?.uid?.slice(0, 8)}</span>
        {other?.email && <span className="chatapp-room-sub">{other.email}</span>}
      </div>
      <div className="chat-messages">
        {messages === null
          ? <div className="loading-wrap"><div className="spinner" /></div>
          : messages.length === 0
          ? <p className="chat-empty">첫 메시지를 보내보세요!</p>
          : messages.map(m => (
            <div key={m.id} className={`chat-msg ${m.user_id === me.uid ? "chat-msg--me" : ""}`}>
              <span className="chat-name">{m.user_id === me.uid ? "나" : m.display_name}</span>
              <span className="chat-bubble">{m.content}</span>
              <span className="chat-time">{new Date(m.created_at + (m.created_at.endsWith("Z") ? "" : "Z")).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input className="input chat-input" value={text} placeholder="메시지 입력…"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn-primary btn-sm" onClick={send} disabled={sending || !text.trim()}>전송</button>
      </div>
    </div>
  );
}

// ── 그룹 채팅창 ───────────────────────────────────────────────────────────────

function GroupChat({ group, me, onBack }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const myName = group.members?.find(m => m.user_id === me.uid)?.display_name
    || me.displayName || me.email?.split("@")[0] || "나";

  useEffect(() => {
    setMessages(null);
    apiFetch(`/groups/${group.id}/messages`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [group.id]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`chat:${group.id}`, { config: { broadcast: { self: false } } });
    channelRef.current = ch;
    ch.on("broadcast", { event: "chat-msg" }, ({ payload }) => {
      setMessages(prev => prev ? [...prev, payload] : [payload]);
    }).subscribe();
    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [group.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      const saved = await apiFetch(`/groups/${group.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, display_name: myName }),
      });
      setMessages(prev => prev ? [...prev, saved] : [saved]);
      channelRef.current?.send({ type: "broadcast", event: "chat-msg", payload: saved }).catch(() => {});
    } catch { setText(content); }
    finally { setSending(false); }
  }

  return (
    <div className="chatapp-room">
      <div className="chatapp-room-header">
        <button className="btn-ghost chatapp-back" onClick={onBack}>←</button>
        <span className="chatapp-room-name">{group.name}</span>
        <span className="chatapp-room-sub">{group.members?.length || 0}명</span>
      </div>
      <div className="chat-messages">
        {messages === null
          ? <div className="loading-wrap"><div className="spinner" /></div>
          : messages.length === 0
          ? <p className="chat-empty">아직 메시지가 없어요. 첫 메시지를 남겨보세요!</p>
          : messages.map(m => (
            <div key={m.id} className={`chat-msg ${m.user_id === me.uid ? "chat-msg--me" : ""}`}>
              <span className="chat-name">{m.user_id === me.uid ? "나" : m.display_name}</span>
              <span className="chat-bubble">{m.content}</span>
              <span className="chat-time">{new Date(m.created_at + (m.created_at.endsWith("Z") ? "" : "Z")).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input className="input chat-input" value={text} placeholder="메시지 입력…"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn-primary btn-sm" onClick={send} disabled={sending || !text.trim()}>전송</button>
      </div>
    </div>
  );
}

// ── 새 DM 시작 (유저 검색) ────────────────────────────────────────────────────

function NewDmPanel({ me, onOpen, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (q.length < 2) return;
    setBusy(true);
    try {
      const data = await apiFetch(`/users/search?q=${encodeURIComponent(q)}`);
      setResults(data.filter(u => u.uid !== me.uid));
    } catch { /* 무시 */ }
    finally { setBusy(false); }
  }

  async function startDm(uid) {
    try {
      const data = await apiFetch("/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ other_user_id: uid }),
      });
      onOpen(data.room_id, data.other);
    } catch { /* 무시 */ }
  }

  return (
    <div className="chatapp-newdm">
      <div className="chatapp-room-header">
        <button className="btn-ghost chatapp-back" onClick={onClose}>←</button>
        <span className="chatapp-room-name">새 대화</span>
      </div>
      <div className="chatapp-newdm-body">
        <div className="sb-search-wrap" style={{ margin: "12px 16px 8px" }}>
          <input className="sb-search-input" value={q} placeholder="이름 또는 이메일 검색 (2자 이상)"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()} />
          <button className="btn-primary btn-sm" onClick={search} disabled={busy || q.length < 2}
            style={{ marginLeft: 6 }}>검색</button>
        </div>
        {results.length > 0 && results.map(u => (
          <button key={u.uid} className="chatapp-user-row" onClick={() => startDm(u.uid)}>
            <span className="chatapp-user-avatar">{(u.display_name || u.email || "?").slice(0, 1).toUpperCase()}</span>
            <span className="chatapp-user-info">
              <span className="chatapp-user-name">{u.display_name || u.email}</span>
              {u.email && <span className="chatapp-user-email">{u.email}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 메인: ChatApp ─────────────────────────────────────────────────────────────

export default function ChatApp({ me, groups = [], groupDetails = {} }) {
  const [tab, setTab] = useState("dm"); // dm | group
  const [dmRooms, setDmRooms] = useState(null);
  const [active, setActive] = useState(null); // { kind: "dm"|"group"|"new-dm", ... }

  useEffect(() => {
    if (tab === "dm") {
      apiFetch("/chat/rooms").then(setDmRooms).catch(() => setDmRooms([]));
    }
  }, [tab]);

  function openDm(roomId, other) {
    setActive({ kind: "dm", roomId, other });
    // 목록 갱신
    setDmRooms(prev => {
      if (!prev) return prev;
      const exists = prev.find(r => r.room_id === roomId);
      if (exists) return prev;
      return [{ room_id: roomId, other, last_message: null, last_at: new Date().toISOString() }, ...prev];
    });
  }

  // 오른쪽 패널
  let rightPanel = null;
  if (active?.kind === "dm") {
    rightPanel = <DmChat roomId={active.roomId} other={active.other} me={me}
      onBack={() => setActive(null)} />;
  } else if (active?.kind === "group") {
    const g = groupDetails[active.groupId] || groups.find(g => g.id === active.groupId);
    if (g) rightPanel = <GroupChat group={g} me={me} onBack={() => setActive(null)} />;
  } else if (active?.kind === "new-dm") {
    rightPanel = <NewDmPanel me={me}
      onOpen={(rid, other) => openDm(rid, other)}
      onClose={() => setActive(null)} />;
  }

  return (
    <div className="chatapp">
      {/* 왼쪽: 목록 */}
      <div className="chatapp-list">
        <div className="chatapp-list-header">
          <span className="chatapp-list-title">채팅</span>
          {tab === "dm" && (
            <button className="sb-add" title="새 대화 시작" onClick={() => setActive({ kind: "new-dm" })}>+</button>
          )}
        </div>

        <div className="sub-tabs" style={{ padding: "0 12px 8px" }}>
          <button className={tab === "dm" ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: 13, padding: "4px 14px" }}
            onClick={() => setTab("dm")}>DM</button>
          <button className={tab === "group" ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: 13, padding: "4px 14px" }}
            onClick={() => setTab("group")}>그룹</button>
        </div>

        <div className="chatapp-rooms">
          {tab === "dm" && (
            dmRooms === null
              ? <div className="loading-wrap"><div className="spinner" /></div>
              : dmRooms.length === 0
              ? <p className="sb-empty" style={{ padding: "20px 16px" }}>아직 대화가 없어요.<br />+ 버튼으로 새 대화를 시작하세요.</p>
              : dmRooms.map(r => (
                <button key={r.room_id}
                  className={`chatapp-room-row ${active?.roomId === r.room_id ? "active" : ""}`}
                  onClick={() => setActive({ kind: "dm", roomId: r.room_id, other: r.other })}>
                  <span className="chatapp-user-avatar">{(r.other?.display_name || "?").slice(0, 1).toUpperCase()}</span>
                  <span className="chatapp-room-info">
                    <span className="chatapp-room-row-name">{r.other?.display_name || r.other?.uid?.slice(0, 8)}</span>
                    <span className="chatapp-room-last">{r.last_message || "대화를 시작해보세요"}</span>
                  </span>
                  <span className="chatapp-room-time">{timeAgo(r.last_at)}</span>
                </button>
              ))
          )}

          {tab === "group" && (
            groups.length === 0
              ? <p className="sb-empty" style={{ padding: "20px 16px" }}>참여 중인 그룹이 없어요.</p>
              : groups.map(g => (
                <button key={g.id}
                  className={`chatapp-room-row ${active?.groupId === g.id ? "active" : ""}`}
                  onClick={() => setActive({ kind: "group", groupId: g.id })}>
                  <span className="chatapp-user-avatar">👥</span>
                  <span className="chatapp-room-info">
                    <span className="chatapp-room-row-name">{g.name}</span>
                    <span className="chatapp-room-last">{g.member_count || ""}명</span>
                  </span>
                </button>
              ))
          )}
        </div>
      </div>

      {/* 오른쪽: 채팅창 */}
      <div className="chatapp-main">
        {rightPanel || (
          <div className="chatapp-empty">
            <p>💬</p>
            <p>대화를 선택하거나 새 대화를 시작해보세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
