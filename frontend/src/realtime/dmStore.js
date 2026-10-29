import { useEffect, useState } from "react";
import { apiFetch } from "../api";

/*
 * DM 대화 목록·안 읽은 개수를 앱 전체가 하나로 같이 쓴다.
 * (예전엔 사이드바·작은 채팅창·큰 채팅창이 각자 세서, 한쪽에서 읽어도 다른 쪽 표시가 안 지워졌다)
 *
 * 기준은 서버의 '읽은 위치'(chat_reads) — 어느 창에서 읽든 같은 숫자가 된다.
 */

let rooms = null;                 // [{ room_id, other, last_message, last_at, unread }]
const listeners = new Set();
const openRooms = new Map();      // room_id → 지금 그 방을 보여주는 창 수 (작은 창 + 큰 창)
let inflight = null;

function emit() { listeners.forEach(fn => fn(rooms)); }
function setRooms(next) { rooms = next; emit(); }

export function refreshDmRooms() {
  if (inflight) return inflight;
  inflight = apiFetch("/chat/rooms")
    .then(list => {
      // 지금 열려 있는 방은 읽는 중이니 0으로 (서버 반영보다 목록 요청이 먼저 끝나는 경우)
      setRooms(list.map(r => (isRoomOpen(r.room_id) ? { ...r, unread: 0 } : r)));
    })
    .catch(() => { if (!rooms) setRooms([]); })
    .finally(() => { inflight = null; });
  return inflight;
}

export function resetDmStore() { openRooms.clear(); seen = {}; saveSeen(); setRooms(null); }

/** 이 방을 읽었다 — 모든 창의 배지에서 지운다 */
export function markDmRead(roomId) {
  if (!rooms) return;
  if (!rooms.some(r => r.room_id === roomId && r.unread)) return;
  if (seen[roomId]) { delete seen[roomId]; saveSeen(); }
  setRooms(rooms.map(r => (r.room_id === roomId ? { ...r, unread: 0 } : r)));
}

/** 목록 맨 위로 올리고 마지막 메시지를 바꾼다 (새로 불러오지 않고) */
export function touchDmRoom(roomId, patch) {
  if (!rooms) return;
  const cur = rooms.find(r => r.room_id === roomId);
  if (!cur) { refreshDmRooms(); return; }
  setRooms([{ ...cur, ...patch }, ...rooms.filter(r => r.room_id !== roomId)]);
}

export function addDmRoom(roomId, other) {
  if (!rooms || rooms.some(r => r.room_id === roomId)) return;
  setRooms([{ room_id: roomId, other, last_message: null, last_at: new Date().toISOString(), unread: 0 }, ...rooms]);
}

/** 대화방 화면이 열려 있는 동안 등록 — 그 방 알림은 띄우지 않는다 */
export function registerOpenRoom(roomId) {
  openRooms.set(roomId, (openRooms.get(roomId) || 0) + 1);
  markDmRead(roomId);
  return () => {
    const n = (openRooms.get(roomId) || 1) - 1;
    if (n <= 0) openRooms.delete(roomId); else openRooms.set(roomId, n);
  };
}

export function isRoomOpen(roomId) {
  return (openRooms.get(roomId) || 0) > 0 && document.visibilityState === "visible";
}

export const totalUnread = (list) => (list || []).reduce((n, r) => n + (r.unread || 0), 0);

// ── 사이드바·채팅 버튼 숫자 (인스타그램 방식) ──
// 대화 목록을 한 번 보면 '새 메시지가 있다는 걸 봤다'로 치고 바깥 숫자를 지운다.
// 목록의 방별 숫자는 그 방을 실제로 열어 읽을 때까지 남는다.
const SEEN_KEY = "studyrag:dm-seen";
let seen = (() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } })();

function saveSeen() { try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* 저장 못 해도 동작은 한다 */ } }

/** 지금 보이는 방별 안 읽은 개수를 '봤음'으로 기록 — 채팅 페이지·작은 창 목록을 열었을 때 */
export function markListSeen() {
  if (!rooms) return;
  const next = Object.fromEntries(rooms.filter(r => r.unread).map(r => [r.room_id, r.unread]));
  if (JSON.stringify(next) === JSON.stringify(seen)) return;
  seen = next;
  saveSeen();
  setRooms([...rooms]); // 새 배열이어야 화면(배지 숫자)이 다시 그려진다
}

/** 바깥 배지 숫자: 목록을 마지막으로 본 뒤에 새로 온 것만 */
export const badgeCount = (list) =>
  (list || []).reduce((n, r) => n + Math.max(0, (r.unread || 0) - (seen[r.room_id] || 0)), 0);

/** 목록 구독. 처음 쓰는 곳에서 서버에서 한 번 불러온다. */
export function useDmRooms() {
  const [state, setState] = useState(rooms);
  useEffect(() => {
    listeners.add(setState);
    setState(rooms);
    if (rooms === null) refreshDmRooms();
    return () => listeners.delete(setState);
  }, []);
  return state;
}
