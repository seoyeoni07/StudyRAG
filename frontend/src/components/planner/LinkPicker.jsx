import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { DocIcon, NoteIcon, renderNoteIcon } from "../Icons.jsx";

/** 할 일에 연결할 자료·노트 고르기. 개인 플래너는 내 것, 스터디 플래너는 그룹 것. */
export default function LinkPicker({ plannerId, current, onPick, onClose }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiFetch(`/planner/${plannerId}/linkables`).then(setItems).catch(() => setItems({ docs: [], notes: [] }));
  }, [plannerId]);

  const match = (s) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <div className="pl-modal-overlay" onClick={onClose}>
      <div className="pl-modal pl-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="pl-modal-head">
          <span>자료·노트 연결</span>
          <button className="btn-ghost" onClick={onClose}>닫기</button>
        </div>
        <input className="input" placeholder="이름으로 찾기" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        {!items ? <div className="loading-wrap"><div className="spinner" /></div> : (
          <div className="pl-link-list">
            {current?.link_type && (
              <button className="pl-link-row pl-link-row--remove" onClick={() => onPick(null)}>✕ 연결 해제</button>
            )}
            <p className="pl-link-group"><DocIcon size="0.85em" /> 강의자료</p>
            {items.docs.filter(d => match(d.label)).map(d => (
              <button key={d.id} className="pl-link-row" onClick={() => onPick({ link_type: "doc", link_id: d.id, link_label: d.label })}>
                <DocIcon size="0.85em" /> {d.label.replace(/\.pdf$/i, "")}
              </button>
            ))}
            {items.docs.length === 0 && <p className="pl-empty">올린 자료가 없어요</p>}
            <p className="pl-link-group"><NoteIcon size="0.85em" /> 노트</p>
            {items.notes.filter(n => match(n.label)).map(n => (
              <button key={n.id} className="pl-link-row" onClick={() => onPick({ link_type: n.type, link_id: n.id, link_label: n.label })}>
                {renderNoteIcon(n.icon, "0.85em") || <NoteIcon size="0.85em" />} {n.label}
              </button>
            ))}
            {items.notes.length === 0 && <p className="pl-empty">노트가 없어요</p>}
          </div>
        )}
      </div>
    </div>
  );
}
