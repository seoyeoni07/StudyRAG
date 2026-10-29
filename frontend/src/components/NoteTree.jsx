import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** parent_id → 하위 페이지 목록 (만든 순서) */
export function childrenMap(list) {
  const ids = new Set(list.map(n => n.id));
  const map = {};
  for (const n of list) {
    if (n.parent_id && ids.has(n.parent_id)) (map[n.parent_id] ||= []).push(n);
  }
  for (const k in map) map[k].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  return map;
}

/** 상위 페이지가 목록에 없으면 최상위로 본다 */
export const isRoot = (n, list) => !n.parent_id || !list.some(x => x.id === n.parent_id);

/** 위에서부터 [최상위, …, 바로 위] */
export function ancestorsOf(id, list) {
  const byId = Object.fromEntries(list.map(n => [n.id, n]));
  const out = [];
  let cur = byId[id];
  while (cur?.parent_id && byId[cur.parent_id] && out.length < 32) {
    cur = byId[cur.parent_id];
    out.unshift(cur);
  }
  return out;
}

export function descendantIds(id, list) {
  const map = childrenMap(list);
  const out = [];
  const walk = (pid) => (map[pid] || []).forEach(c => { out.push(c.id); walk(c.id); });
  walk(id);
  return out;
}

function Caret({ open, onClick, hidden }) {
  return (
    <span className={`sb-caret ${open ? "open" : ""} ${hidden ? "sb-caret--empty" : ""}`} role="button"
      aria-label={open ? "접기" : "펼치기"} onClick={e => { e.stopPropagation(); onClick(); }}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 노트 오른쪽 ⋯ 메뉴 */
function NoteMenu({ note, anchor, all, allowPin, canDelete, onAction, onRename, onMove, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -999, left: -999 });
  const [confirm, setConfirm] = useState(false);
  const kids = descendantIds(note.id, all).length;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight || 260;
    const w = ref.current?.offsetWidth || 220;
    setPos({
      top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8)),
      left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
    });
  }, [anchor, confirm]);

  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [anchor, onClose]);

  const act = (fn) => () => { onClose(); fn(); };

  return createPortal(
    <div ref={ref} className="nt-menu" style={pos} role="menu">
      {confirm ? (
        <div className="nt-confirm">
          <p><strong>“{note.title || "제목 없음"}”</strong>을(를) 삭제할까요?</p>
          {kids > 0 && <p className="nt-warn">하위 페이지 {kids}개도 함께 삭제돼요.</p>}
          {note.group_id && <p className="nt-warn">그룹 멤버 모두에게서 사라져요.</p>}
          <div className="nt-confirm-btns">
            <button className="btn-ghost btn-sm" onClick={() => setConfirm(false)}>취소</button>
            <button className="btn-danger btn-sm" onClick={act(() => onAction("delete", note))}>삭제</button>
          </div>
        </div>
      ) : (
        <>
          <button role="menuitem" onClick={act(() => onAction("add-child", note))}><span>＋</span>하위 노트 추가</button>
          <button role="menuitem" onClick={act(onRename)}><span>✏️</span>이름 바꾸기</button>
          {allowPin && (
            <button role="menuitem" onClick={act(() => onAction("pin", note))}>
              <span>{note.pinned ? "☆" : "⭐"}</span>{note.pinned ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
            </button>
          )}
          <button role="menuitem" onClick={act(() => onAction("duplicate", note))}><span>📑</span>복제</button>
          <button role="menuitem" onClick={act(onMove)}><span>↪</span>옮기기</button>
          {canDelete && (
            <>
              <div className="nt-sep" />
              <button role="menuitem" className="nt-danger" onClick={() => setConfirm(true)}><span>🗑</span>삭제</button>
            </>
          )}
          <div className="nt-meta">
            {note.creator_name && <div>만든 사람 · {note.creator_name}</div>}
            {note.updated_at && <div>마지막 수정 · {fmtTime(note.updated_at)}</div>}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

/** 옮기기: 상위 페이지 고르기 (자기 자신·하위 페이지는 제외) */
function MoveModal({ note, all, onPick, onClose }) {
  const [q, setQ] = useState("");
  const banned = new Set([note.id, ...descendantIds(note.id, all)]);
  const map = childrenMap(all);
  const rows = [];
  const walk = (n, depth) => {
    if (banned.has(n.id)) return;
    rows.push([n, depth]);
    (map[n.id] || []).forEach(c => walk(c, depth + 1));
  };
  all.filter(n => isRoot(n, all)).forEach(n => walk(n, 0));
  const shown = q ? rows.filter(([n]) => (n.title || "제목 없음").toLowerCase().includes(q.toLowerCase())) : rows;

  return createPortal(
    <div className="nt-modal-overlay" onClick={onClose}>
      <div className="nt-modal" onClick={e => e.stopPropagation()}>
        <div className="nt-modal-head">
          <span>“{note.title || "제목 없음"}” 옮기기</span>
          <button className="btn-ghost btn-sm" onClick={onClose}>닫기</button>
        </div>
        <input className="input" autoFocus placeholder="페이지 검색…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="nt-modal-list">
          {!q && (
            <button className={`nt-move-row ${!note.parent_id ? "current" : ""}`} disabled={!note.parent_id}
              onClick={() => onPick(null)}>
              <span>⬆</span>맨 위로 (상위 페이지 없음){!note.parent_id && <em>지금 위치</em>}
            </button>
          )}
          {shown.map(([n, depth]) => (
            <button key={n.id} className={`nt-move-row ${note.parent_id === n.id ? "current" : ""}`}
              style={{ paddingLeft: 10 + (q ? 0 : depth * 16) }} disabled={note.parent_id === n.id}
              onClick={() => onPick(n.id)}>
              <span>{n.icon || "📝"}</span>{n.title || "제목 없음"}{note.parent_id === n.id && <em>지금 위치</em>}
            </button>
          ))}
          {shown.length === 0 && q && <p className="sb-empty">검색 결과 없음</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 사이드바 노트 트리 (노션처럼 하위 페이지를 펼쳐 보고, 오른쪽 ⋯ 메뉴로 관리)
 * roots: 맨 위에 보일 노트, all: 하위 페이지를 찾을 전체 목록(같은 공간)
 * onAction(kind, note, extra): add-child | rename | pin | duplicate | move | delete
 */
export default function NoteTree({
  roots, all, activeId, onOpen, onAction, expanded, setExpanded, prefix = "",
  allowPin = false, canDelete = () => true, flat = false, child = false, defaultIcon = "📝",
}) {
  const [menu, setMenu] = useState(null);       // { note, anchor }
  const [editing, setEditing] = useState(null); // note id
  const [moving, setMoving] = useState(null);   // note
  const map = flat ? {} : childrenMap(all);
  const openSet = new Set(activeId ? ancestorsOf(activeId, all).map(n => n.id) : []);
  const isOpen = (id) => expanded[`${prefix}n:${id}`] ?? openSet.has(id);
  const toggle = (id) => setExpanded(e => ({ ...e, [`${prefix}n:${id}`]: !isOpen(id) }));

  function commitRename(n, value) {
    setEditing(null);
    const t = value.trim();
    if (t !== (n.title || "")) onAction("rename", n, t);
  }

  const renderNode = (n, depth) => {
    const kids = map[n.id] || [];
    const open = kids.length > 0 && isOpen(n.id);
    return (
      <div key={n.id}>
        <div className={`sb-item nt-row ${child || depth > 0 ? "sb-child" : ""} ${activeId === n.id ? "active" : ""} ${menu?.note.id === n.id ? "nt-row--menu" : ""}`}
          style={depth ? { paddingLeft: 8 + depth * 14 } : undefined}
          role="button" tabIndex={0} title={n.title || "제목 없음"}
          onClick={() => editing !== n.id && onOpen(n)}
          onKeyDown={e => { if (e.key === "Enter" && editing !== n.id && e.target === e.currentTarget) onOpen(n); }}>
          {!flat && <Caret open={open} hidden={!kids.length} onClick={() => kids.length && toggle(n.id)} />}
          <span className="sb-icon">{n.icon || defaultIcon}</span>
          {editing === n.id ? (
            <input className="nt-rename" autoFocus defaultValue={n.title || ""} maxLength={256}
              onClick={e => e.stopPropagation()}
              onFocus={e => e.target.select()}
              onBlur={e => commitRename(n, e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                if (e.key === "Escape") setEditing(null);
              }} />
          ) : (
            <span className="sb-label">{n.title || "제목 없음"}</span>
          )}
          {editing !== n.id && (
            <span className="nt-actions">
              <button className="nt-btn" title="메뉴 (삭제·이름 바꾸기·옮기기 등)" aria-label="노트 메뉴"
                onClick={e => { e.stopPropagation(); const a = e.currentTarget; setMenu(m => (m?.note.id === n.id ? null : { note: n, anchor: a })); }}>⋯</button>
              <button className="nt-btn" title="하위 노트 추가" aria-label="하위 노트 추가"
                onClick={e => { e.stopPropagation(); onAction("add-child", n); }}>＋</button>
            </span>
          )}
        </div>
        {open && (
          <div>
            {kids.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {roots.map(n => renderNode(n, 0))}
      {menu && (
        <NoteMenu note={menu.note} anchor={menu.anchor} all={all} allowPin={allowPin}
          canDelete={canDelete(menu.note)} onAction={onAction}
          onRename={() => setEditing(menu.note.id)} onMove={() => setMoving(menu.note)}
          onClose={() => setMenu(null)} />
      )}
      {moving && (
        <MoveModal note={moving} all={all} onClose={() => setMoving(null)}
          onPick={(pid) => { setMoving(null); onAction("move", moving, pid); if (pid) setExpanded(e => ({ ...e, [`${prefix}n:${pid}`]: true })); }} />
      )}
    </>
  );
}
