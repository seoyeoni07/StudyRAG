import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiFetch } from "../api";

const ICONS = ["📝", "📒", "📘", "📗", "📙", "💡", "⭐", "🔖", "🧠", "📌", "✏️", "🎯"];

export default function NotePage({ noteId, pastDocs, onChanged, onDeleted, onOpenDoc }) {
  const [note, setNote] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState("saved"); // saved | dirty | saving
  const [iconOpen, setIconOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef({});
  const timer = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    setNote(null); setError(""); setEditing(false); setConfirmDelete(false);
    apiFetch(`/notes/${noteId}`)
      .then(n => { setNote(n); if (!n.content) setEditing(true); })
      .catch(err => setError(err.message));
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [editing, note?.content]);

  async function flush() {
    clearTimeout(timer.current);
    const fields = pending.current;
    if (!Object.keys(fields).length) return;
    pending.current = {};
    setSaveState("saving");
    try {
      const saved = await apiFetch(`/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      onChanged?.(saved);
      setSaveState(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch (err) {
      setError(err.message);
      setSaveState("dirty");
    }
  }

  function update(fields, immediate = false) {
    setNote(n => ({ ...n, ...fields }));
    pending.current = { ...pending.current, ...fields };
    setSaveState("dirty");
    clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, 700);
  }

  async function handleDelete() {
    clearTimeout(timer.current);
    pending.current = {};
    try {
      await apiFetch(`/notes/${noteId}`, { method: "DELETE" });
      onDeleted?.(noteId);
    } catch (err) { setError(err.message); }
  }

  if (error && !note) return <div className="error-banner"><span>{error}</span></div>;
  if (!note) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
      </div>
    );
  }

  const linkedDoc = pastDocs.find(d => d.doc_id === note.doc_id);

  return (
    <div className="note-page">
      <div className="note-icon-wrap">
        <button className="note-icon" onClick={() => setIconOpen(o => !o)} title="아이콘 변경">
          {note.icon || "📝"}
        </button>
        {iconOpen && (
          <div className="note-icon-picker" role="listbox">
            {ICONS.map(ic => (
              <button key={ic} className="note-icon-option"
                onClick={() => { update({ icon: ic }, true); setIconOpen(false); }}>{ic}</button>
            ))}
          </div>
        )}
      </div>

      <input className="note-title" value={note.title} placeholder="제목 없음"
        onChange={e => update({ title: e.target.value })}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setEditing(true); setTimeout(() => bodyRef.current?.focus(), 0); } }} />

      <div className="note-props">
        <div className="note-prop">
          <span className="note-prop-key">연결된 자료</span>
          <select className="note-prop-select" value={note.doc_id || ""}
            onChange={e => update({ doc_id: e.target.value || null }, true)}>
            <option value="">없음</option>
            {pastDocs.map(d => <option key={d.doc_id} value={d.doc_id}>{d.filename}</option>)}
          </select>
          {linkedDoc && (
            <button className="note-prop-link" onClick={() => onOpenDoc?.(linkedDoc.doc_id, linkedDoc.filename)}>열기 ↗</button>
          )}
        </div>
        <div className="note-prop">
          <span className="note-prop-key">수정</span>
          <span className="note-prop-val">
            {note.updated_at ? new Date(note.updated_at + (note.updated_at.endsWith("Z") ? "" : "Z")).toLocaleString("ko-KR") : "—"}
            <span className="note-save-state">
              {saveState === "saving" ? " · 저장 중…" : saveState === "dirty" ? " · 편집 중" : " · 저장됨"}
            </span>
          </span>
        </div>
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}

      {editing ? (
        <textarea ref={bodyRef} className="note-body-edit" value={note.content} autoFocus
          placeholder="내용을 입력하세요. 마크다운을 쓸 수 있어요 (# 제목, - 목록, **굵게**, $수식$)"
          onChange={e => update({ content: e.target.value })}
          onBlur={() => { flush(); if (note.content.trim()) setEditing(false); }} />
      ) : (
        <div className="note-body answer-text" onClick={() => setEditing(true)} title="클릭해서 편집">
          {note.content.trim()
            ? <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{note.content}</ReactMarkdown>
            : <p className="note-placeholder">클릭해서 작성을 시작하세요…</p>}
        </div>
      )}

      <div className="note-footer">
        {confirmDelete ? (
          <>
            <span className="note-footer-text">이 노트를 삭제할까요?</span>
            <button className="btn-danger" onClick={handleDelete}>삭제</button>
            <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>취소</button>
          </>
        ) : (
          <button className="btn-ghost" onClick={() => setConfirmDelete(true)}>노트 삭제</button>
        )}
      </div>
    </div>
  );
}
