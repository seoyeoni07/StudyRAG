import { supabase } from "../supabase";

/*
 * 채팅용 실시간 채널 공유.
 * 같은 대화방이 채팅 페이지와 오른쪽 아래 작은 채팅창에 동시에 열릴 수 있다.
 * Supabase는 같은 이름의 채널을 하나만 두기 때문에, 한쪽이 닫으며 채널을 지우면
 * 다른 쪽도 끊긴다 → 이름별로 채널 하나를 같이 쓰고, 마지막 사용자가 떠날 때만 지운다.
 */
const topics = new Map(); // topic → { ch, handlers: Map<event, Set<fn>> }

export function subscribeBroadcast(topic, event, handler) {
  if (!supabase) return () => {};
  let t = topics.get(topic);
  if (!t) {
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    t = { ch, handlers: new Map() };
    topics.set(topic, t);
    ch.subscribe();
  }
  if (!t.handlers.has(event)) {
    const set = new Set();
    t.handlers.set(event, set);
    // broadcast 리스너는 subscribe 뒤에도 추가할 수 있다
    t.ch.on("broadcast", { event }, ({ payload }) => set.forEach(fn => fn(payload)));
  }
  t.handlers.get(event).add(handler);

  return () => {
    const cur = topics.get(topic);
    if (!cur) return;
    cur.handlers.get(event)?.delete(handler);
    const left = [...cur.handlers.values()].reduce((n, s) => n + s.size, 0);
    if (left === 0) {
      topics.delete(topic);
      supabase.removeChannel(cur.ch);
    }
  };
}

/** 구독하지 않은 채널(예: 상대방 inbox)에도 보낼 수 있게 — 열려 있으면 그 채널로, 아니면 HTTP로 보낸다. */
export function sendBroadcast(topic, event, payload) {
  if (!supabase) return;
  const t = topics.get(topic);
  if (t) {
    t.ch.send({ type: "broadcast", event, payload }).catch(() => {});
    return;
  }
  const existed = supabase.getChannels().some(c => c.topic === `realtime:${topic}`);
  const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
  ch.httpSend(event, payload)
    .catch(() => {})
    .finally(() => { if (!existed) supabase.removeChannel(ch); });
}
