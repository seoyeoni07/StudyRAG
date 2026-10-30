import { useEffect, useState } from "react";
import ChatRoom, { timeAgo } from "./ChatRoom";
import { NewDmPanel } from "../ChatApp";
import { useDmRooms, refreshDmRooms, addDmRoom, markListSeen } from "../../realtime/dmStore";
import { UsersIcon } from "../Icons.jsx";

/*
 * 화면 오른쪽 아래 작은 채팅창 (인스타그램 DM처럼).
 * 어느 화면에서든 대화 목록을 열고 바로 답장할 수 있다. 채팅 페이지에 있을 땐 숨긴다.
 * 대화 목록·안 읽은 개수는 큰 채팅창·사이드바와 같은 것을 쓴다 (realtime/dmStore).
 */
export default function ChatWidget({ me, groups = [], groupDetails = {}, unread = 0, onExpand }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("dm");          // dm | group
  const [active, setActive] = useState(null);    // { kind: "dm"|"group"|"new-dm", ... }
  const dmRooms = useDmRooms();
  const myName = me.displayName || me.email?.split("@")[0] || "나";

  // 열 때 한 번 최신으로 (그 뒤로는 앱 전체가 같은 목록을 갱신한다)
  useEffect(() => { if (open && tab === "dm") refreshDmRooms(); }, [open, tab]);
  // 작은 창이 열려 있는 동안은 새로 온 것도 '봤음' — 채팅 버튼·사이드바 숫자를 지운다
  useEffect(() => { if (open) markListSeen(); }, [open, dmRooms]);

  function openDm(roomId, other) {
    setActive({ kind: "dm", roomId, other });
    addDmRoom(roomId, other);
  }

  let body;
  if (active?.kind === "dm") {
    body = (
      <ChatRoom key={active.roomId} compact kind="dm" id={active.roomId} me={me} myName={myName}
        other={active.other}
        title={active.other?.display_name || active.other?.uid?.slice(0, 8)}
        onBack={() => setActive(null)} />
    );
  } else if (active?.kind === "group") {
    const g = groupDetails[active.groupId] || groups.find(x => x.id === active.groupId);
    body = g && (
      <ChatRoom key={g.id} compact kind="group" id={g.id} me={me}
      memberIds={g.members?.map(m => m.user_id)}
        myName={g.members?.find(m => m.user_id === me.uid)?.display_name || myName}
        title={g.name} subtitle={`${g.members?.length || g.member_count || 0}명`}
        emptyText="아직 메시지가 없어요. 첫 메시지를 남겨보세요!"
        onBack={() => setActive(null)} />
    );
  } else if (active?.kind === "new-dm") {
    body = <NewDmPanel me={me} onOpen={openDm} onClose={() => setActive(null)} />;
  } else {
    body = (
      <div className="chatw-list">
        <div className="chatw-tabs">
          <button className={`chatw-tab ${tab === "dm" ? "active" : ""}`} onClick={() => setTab("dm")}>개인</button>
          <button className={`chatw-tab ${tab === "group" ? "active" : ""}`} onClick={() => setTab("group")}>그룹</button>
        </div>
        <div className="chatw-rooms">
          {tab === "dm" && (dmRooms === null ? (
            <div className="loading-wrap"><div className="spinner" /></div>
          ) : dmRooms.length === 0 ? (
            <p className="chatw-empty">아직 대화가 없어요.<br />✎ 버튼으로 새 대화를 시작하세요.</p>
          ) : dmRooms.map(r => (
            <button key={r.room_id} className="chatapp-room-row"
              onClick={() => setActive({ kind: "dm", roomId: r.room_id, other: r.other })}>
              <span className="chatapp-user-avatar">{(r.other?.display_name || "?").slice(0, 1).toUpperCase()}</span>
              <span className="chatapp-room-info">
                <span className="chatapp-room-row-name">{r.other?.display_name || r.other?.uid?.slice(0, 8)}</span>
                <span className="chatapp-room-last">{r.last_message || "대화를 시작해보세요"}</span>
              </span>
              <span className="chatapp-room-time">{timeAgo(r.last_at)}</span>
              {r.unread > 0 && active?.roomId !== r.room_id && <span className="chatapp-room-unread">{r.unread > 99 ? "99+" : r.unread}</span>}
            </button>
          )))}
          {tab === "group" && (groups.length === 0 ? (
            <p className="chatw-empty">참여 중인 그룹이 없어요.</p>
          ) : groups.map(g => (
            <button key={g.id} className="chatapp-room-row" onClick={() => setActive({ kind: "group", groupId: g.id })}>
              <span className="chatapp-user-avatar"><UsersIcon size="1em" /></span>
              <span className="chatapp-room-info">
                <span className="chatapp-room-row-name">{g.name}</span>
                <span className="chatapp-room-last">{g.member_count || ""}명</span>
              </span>
            </button>
          )))}
        </div>
      </div>
    );
  }

  return (
    <>
      {open && (
        <div className="chatw-panel" role="dialog" aria-label="메시지">
          {!active && (
            <div className="chatw-header">
              <span className="chatw-title">메시지</span>
              <button className="chatw-icon" title="새 대화" onClick={() => { setTab("dm"); setActive({ kind: "new-dm" }); }}>✎</button>
              <button className="chatw-icon" title="크게 보기" onClick={() => { setOpen(false); onExpand?.(); }}>⤢</button>
              <button className="chatw-icon" title="닫기" onClick={() => setOpen(false)}>✕</button>
            </div>
          )}
          {active && (
            <button className="chatw-close-float" title="닫기" onClick={() => setOpen(false)}>✕</button>
          )}
          <div className="chatw-body">{body}</div>
        </div>
      )}
      <button className={`chatw-fab ${open ? "chatw-fab--open" : ""}`} onClick={() => setOpen(o => !o)}
        aria-label={open ? "메시지 닫기" : "메시지 열기"}>
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" /></svg>
        )}
        {!open && unread > 0 && <span className="chatw-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
    </>
  );
}
