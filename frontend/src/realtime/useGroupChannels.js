import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";

/**
 * 내가 속한 그룹마다 Supabase 채널(group:{id})에 접속해서
 *  - presence: 지금 접속 중인 멤버 (+ 보고 있는 페이지)
 *  - broadcast: 자료 업로드·노트 생성 같은 그룹 이벤트
 * 를 주고받는다.
 *
 * 반환: { online: { [groupId]: [{ user_id, name, viewing }] }, notify(groupId, event, payload), setViewing(groupId, viewing) }
 */
export function useGroupChannels(groups, user, onEvent) {
  const [online, setOnline] = useState({});
  const channels = useRef({});
  const viewingRef = useRef({});
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const groupKey = groups.map(g => g.id).sort().join(",");
  const name = user?.displayName || user?.email?.split("@")[0] || "멤버";

  useEffect(() => {
    if (!supabase || !user) return;
    const ids = groupKey ? groupKey.split(",") : [];
    const opened = {};

    for (const id of ids) {
      const ch = supabase.channel(`group:${id}`, {
        config: { presence: { key: user.uid }, broadcast: { self: false } },
      });
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        const list = Object.values(state).map(metas => metas[metas.length - 1]);
        setOnline(o => ({ ...o, [id]: list }));
      })
        .on("broadcast", { event: "group-event" }, ({ payload }) => {
          onEventRef.current?.(id, payload);
        })
        .subscribe(status => {
          if (status === "SUBSCRIBED") {
            ch.track({ user_id: user.uid, name, viewing: viewingRef.current[id] || null });
          }
        });
      opened[id] = ch;
    }
    channels.current = opened;

    return () => {
      Object.values(opened).forEach(ch => ch.unsubscribe());
      channels.current = {};
      setOnline({});
    };
  }, [groupKey, user, name]);

  const notify = useCallback((groupId, event, payload = {}) => {
    channels.current[groupId]?.send({
      type: "broadcast", event: "group-event",
      payload: { event, by: user?.uid, by_name: name, ...payload },
    });
  }, [user, name]);

  const setViewing = useCallback((groupId, viewing) => {
    if (!groupId || viewingRef.current[groupId] === viewing) return;
    viewingRef.current[groupId] = viewing;
    channels.current[groupId]?.track({ user_id: user?.uid, name, viewing });
  }, [user, name]);

  return { online, notify, setViewing, enabled: !!supabase };
}
