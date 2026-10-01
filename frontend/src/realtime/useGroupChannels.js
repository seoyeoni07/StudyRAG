import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";

/**
 * 내가 속한 그룹마다 Supabase 채널(group:{id})에 접속해서
 *  - presence: 지금 접속 중인 멤버 (+ 보고 있는 페이지)
 *  - broadcast: 자료 업로드·노트 생성 같은 그룹 이벤트
 * 를 주고받는다.
 *
 * 그룹 목록이 바뀌어도 기존 채널은 그대로 두고 추가·삭제된 그룹만 연결/해제한다
 * (전체를 끊었다 다시 붙이면 다른 멤버 화면에서 접속자가 깜빡이고, 그 사이 알림을 놓친다).
 *
 * nameFor(groupId): 그 그룹에서 쓰는 내 표시 이름 — 멤버 목록과 같은 이름으로 보이게 한다.
 * 반환: { online: { [groupId]: [{ user_id, name, viewing }] }, notify, setViewing, enabled }
 */
export function useGroupChannels(groups, user, onEvent, nameFor) {
  const [online, setOnline] = useState({});
  const channels = useRef({});      // groupId → RealtimeChannel
  const viewingRef = useRef({});    // groupId → 보고 있는 페이지
  const onEventRef = useRef(onEvent);
  const nameForRef = useRef(nameFor);
  useEffect(() => { onEventRef.current = onEvent; nameForRef.current = nameFor; });

  const uid = user?.uid;
  const fallbackName = user?.displayName || user?.email?.split("@")[0] || "멤버";
  const groupKey = groups.map(g => g.id).sort().join(",");

  const myName = useCallback(
    (groupId) => nameForRef.current?.(groupId) || fallbackName,
    [fallbackName],
  );

  const lastSent = useRef({});      // groupId → 마지막으로 보낸 presence (같으면 다시 안 보냄)
  const track = useCallback((groupId, force = false) => {
    const ch = channels.current[groupId];
    if (!ch) return;
    const state = { user_id: uid, name: myName(groupId), viewing: viewingRef.current[groupId] || null };
    const key = JSON.stringify(state);
    if (!force && lastSent.current[groupId] === key) return;
    lastSent.current[groupId] = key;
    ch.track(state);
  }, [uid, myName]);

  // 그룹 추가·삭제분만 연결/해제
  useEffect(() => {
    if (!supabase || !uid) return;
    const wanted = new Set(groupKey ? groupKey.split(",") : []);

    for (const [id, ch] of Object.entries(channels.current)) {
      if (!wanted.has(id)) {
        supabase.removeChannel(ch);
        delete channels.current[id];
        delete lastSent.current[id];
        setOnline(o => { const n = { ...o }; delete n[id]; return n; });
      }
    }
    for (const id of wanted) {
      if (channels.current[id]) continue;
      const ch = supabase.channel(`group:${id}`, {
        config: { presence: { key: uid }, broadcast: { self: false } },
      });
      ch.on("presence", { event: "sync" }, () => {
        if (channels.current[id] !== ch) return; // 이미 해제된 채널의 늦은 이벤트
        const list = Object.values(ch.presenceState()).map(metas => metas[metas.length - 1]);
        setOnline(o => ({ ...o, [id]: list }));
      })
        .on("broadcast", { event: "group-event" }, ({ payload }) => {
          onEventRef.current?.(id, payload);
        })
        .subscribe(status => { if (status === "SUBSCRIBED") track(id, true); });
      channels.current[id] = ch;
    }
  }, [groupKey, uid, track]);

  // 로그아웃·언마운트 시 전부 해제
  useEffect(() => () => {
    Object.values(channels.current).forEach(ch => supabase?.removeChannel(ch));
    channels.current = {};
    lastSent.current = {};
    setOnline({});
  }, [uid]);

  const notify = useCallback((groupId, event, payload = {}) => {
    channels.current[groupId]?.send({
      type: "broadcast", event: "group-event",
      payload: { event, by: uid, by_name: myName(groupId), ...payload },
    });
  }, [uid, myName]);

  const setViewing = useCallback((groupId, viewing) => {
    if (!groupId || viewingRef.current[groupId] === viewing) return;
    viewingRef.current[groupId] = viewing;
    track(groupId);
  }, [track]);

  /** 그룹 표시 이름이 정해진(멤버 목록을 불러온) 뒤 presence 이름을 갱신한다. */
  const refreshName = useCallback((groupId) => track(groupId), [track]);

  return { online, notify, setViewing, refreshName, enabled: !!supabase };
}
