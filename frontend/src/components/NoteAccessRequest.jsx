import { useState } from "react";
import { apiFetch } from "../api";
import { sendBroadcast } from "../realtime/chatBus";

export default function NoteAccessRequest({ noteId, user }) {
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  async function requestAccess() {
    setStatus("sending");
    try {
      const res = await apiFetch(`/notes/${noteId}/request-access`, { method: "POST" });
      if (res.owner_id) {
        const from = user?.displayName || user?.email?.split("@")[0] || "누군가";
        sendBroadcast(`inbox:${res.owner_id}`, "note-access-request", {
          note_id: noteId,
          title: res.title,
          from,
          from_id: user?.uid,
        });
      }
      setStatus("sent");
    } catch (err) {
      if (err.message?.includes("이미 접근")) {
        setStatus("already");
      } else {
        setStatus("error");
      }
    }
  }

  return (
    <div className="access-req-root">
      <div className="access-req-lock">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h2 className="access-req-title">비공개 노트</h2>
      <p className="access-req-desc">이 노트를 보려면 소유자의 허가가 필요합니다.</p>

      {status === "idle" && (
        <button className="btn-primary access-req-btn" onClick={requestAccess}>
          접근 권한 요청
        </button>
      )}
      {status === "sending" && (
        <div className="access-req-sending">
          <div className="spinner spinner-sm" />
          <span>요청 중...</span>
        </div>
      )}
      {status === "sent" && (
        <div className="access-req-done">
          요청을 보냈습니다. 소유자가 승인하면 알림이 와요.
        </div>
      )}
      {status === "already" && (
        <div className="access-req-done">
          이미 접근 권한이 있습니다. 페이지를 새로고침해보세요.
        </div>
      )}
      {status === "error" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--red)" }}>요청에 실패했습니다.</span>
          <button className="btn-secondary" onClick={requestAccess}>다시 시도</button>
        </div>
      )}
    </div>
  );
}
