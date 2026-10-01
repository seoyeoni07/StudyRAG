import * as Y from "yjs";
import {
  Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates,
} from "y-protocols/awareness";

const toB64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/**
 * Supabase Realtime Broadcast 채널로 Yjs 문서와 awareness(커서·접속자)를 주고받는 provider.
 *
 * - 로컬 수정은 50ms 단위로 묶어서(Y.mergeUpdates) 전송 — Supabase 초당 메시지 제한 대비
 * - 새로 들어온 사람은 자기 state vector를 보내고(sync-req), 다른 사람들이 빠진 부분만 답장
 * - 영구 저장은 이 provider가 아니라 호출 측(백엔드 PUT /notes/{id}/ydoc)이 맡는다
 */
export class SupabaseYjsProvider {
  constructor(supabase, channelName, doc) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.connected = false;
    this._pending = [];
    this._flushTimer = null;
    this._listeners = new Set();

    this.channel = supabase.channel(channelName, { config: { broadcast: { self: false, ack: false } } });

    this.channel
      .on("broadcast", { event: "y-update" }, ({ payload }) => {
        Y.applyUpdate(this.doc, fromB64(payload.u), this);
      })
      .on("broadcast", { event: "sync-req" }, ({ payload }) => {
        const diff = Y.encodeStateAsUpdate(this.doc, fromB64(payload.sv));
        if (diff.length > 2) this._send("y-update", { u: toB64(diff) });
        this._sendAwareness([this.doc.clientID]);
      })
      .on("broadcast", { event: "awareness" }, ({ payload }) => {
        applyAwarenessUpdate(this.awareness, fromB64(payload.a), this);
      })
      .subscribe((status) => {
        const was = this.connected;
        this.connected = status === "SUBSCRIBED";
        if (this.connected && !was) {
          this._send("sync-req", { sv: toB64(Y.encodeStateVector(this.doc)) });
          this._sendAwareness([this.doc.clientID]);
        }
        this._emit();
      });

    this._onDocUpdate = (update, origin) => {
      if (origin === this) return;
      this._pending.push(update);
      if (!this._flushTimer) this._flushTimer = setTimeout(() => this._flush(), 50);
    };
    this._onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      this._sendAwareness([...added, ...updated, ...removed]);
    };
    this._onUnload = () => removeAwarenessStates(this.awareness, [this.doc.clientID], "window unload");

    doc.on("update", this._onDocUpdate);
    this.awareness.on("update", this._onAwarenessUpdate);
    window.addEventListener("beforeunload", this._onUnload);
  }

  onStatus(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { this._listeners.forEach(fn => fn(this.connected)); }

  _send(event, payload) {
    if (!this.connected) return;
    this.channel.send({ type: "broadcast", event, payload });
  }

  _flush() {
    this._flushTimer = null;
    if (!this._pending.length) return;
    const merged = Y.mergeUpdates(this._pending);
    this._pending = [];
    this._send("y-update", { u: toB64(merged) });
  }

  _sendAwareness(clients) {
    this._send("awareness", { a: toB64(encodeAwarenessUpdate(this.awareness, clients)) });
  }

  destroy() {
    clearTimeout(this._flushTimer);
    this._flush();
    removeAwarenessStates(this.awareness, [this.doc.clientID], "provider destroy");
    this.doc.off("update", this._onDocUpdate);
    this.awareness.off("update", this._onAwarenessUpdate);
    window.removeEventListener("beforeunload", this._onUnload);
    this.awareness.destroy();
    this.channel.unsubscribe();
    this._listeners.clear();
  }
}

/** Supabase가 설정되지 않았을 때 쓰는 빈 provider — 편집·저장은 되지만 실시간 공유는 없다. */
export class OfflineProvider {
  constructor(doc) { this.doc = doc; this.awareness = new Awareness(doc); this.connected = false; }
  onStatus() { return () => {}; }
  destroy() { this.awareness.destroy(); }
}

export { toB64, fromB64 };
