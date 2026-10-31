import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, BASE } from "../../api";
import { DocIcon, NoteIcon, SparkleIcon, BookIcon } from "../Icons.jsx";
import "./learn.css";

/**
 * 근거 보기: 답변·요약이 가리키는 자료 페이지를 연다.
 * - "텍스트" 탭: 그 페이지에서 뽑은 글자. 드래그하면 노트·카드·퀴즈로 보낼 수 있다.
 * - "원본" 탭: PDF 그 페이지 (또는 이미지)
 * actions: { saveNote(title, md), makeCards(text, page), makeQuiz(text) }
 */
export default function SourceViewer({ docId, page: startPage = 1, quote, filename, onClose, actions = {} }) {
  const [page, setPage] = useState(startPage || 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("text");
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const textRef = useRef(null);

  useEffect(() => {
    let off = false;
    setData(null); setError(""); setSel("");
    apiFetch(`/documents/${docId}/page/${page}`)
      .then(d => { if (!off) setData(d); })
      .catch(e => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [docId, page]);

  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  // 인용한 구절이 보이게 스크롤
  useEffect(() => {
    if (mode === "text" && data) textRef.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [data, mode]);

  function onSelect() {
    const s = window.getSelection();
    const t = s && textRef.current?.contains(s.anchorNode) ? s.toString().trim() : "";
    setSel(t.length >= 4 ? t.slice(0, 4000) : "");
  }

  async function run(kind) {
    const text = sel || data?.text || "";
    if (!text.trim()) return;
    setBusy(kind); setMsg("");
    try {
      const name = (filename || data?.filename || "자료").replace(/\.pdf$/i, "");
      if (kind === "note") {
        await actions.saveNote?.(`${name} p.${page}`, `> ${text.replace(/\n/g, "\n> ")}\n\n— ${name} ${page}페이지`);
        setMsg("노트로 저장했어요.");
      } else if (kind === "cards") {
        const n = await actions.makeCards?.(text, page);
        setMsg(`플래시카드 ${n ?? ""}장을 만들었어요.`);
      } else if (kind === "quiz") {
        await actions.makeQuiz?.(text);
        onClose();
      }
    } catch (e) { setMsg(e.message); }
    finally { setBusy(""); }
  }

  const text = data?.text || "";
  const q = (quote || "").trim().slice(0, 80);
  const at = q ? text.indexOf(q) : -1;
  const fileUrl = `${BASE}/documents/${docId}/file?inline=1`;

  return createPortal(
    <div className="sv-overlay" onClick={onClose}>
      <div className="sv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="근거 보기">
        <div className="sv-head">
          <span className="sv-title"><DocIcon size="1em" /> {(filename || data?.filename || "자료").replace(/\.pdf$/i, "")}</span>
          <div className="sv-pager">
            <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="이전 페이지">‹</button>
            <span>{page}페이지</span>
            <button className="btn-ghost btn-sm" onClick={() => setPage(p => p + 1)} aria-label="다음 페이지">›</button>
          </div>
          <div className="lr-seg">
            <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>텍스트</button>
            <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")} disabled={data && !data.has_file}>원본</button>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>닫기</button>
        </div>

        {error && <div className="error-banner"><span>{error}</span></div>}

        <div className="sv-body">
          {!data && !error && <div className="loading-wrap"><div className="spinner" /></div>}
          {data && mode === "text" && (
            text ? (
              <div className="sv-text" ref={textRef} onMouseUp={onSelect} onTouchEnd={onSelect} onKeyUp={onSelect}>
                {at >= 0 ? <>{text.slice(0, at)}<mark>{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</> : text}
              </div>
            ) : <p className="lr-empty">이 페이지에서 뽑은 글자가 없어요. {data.has_file ? "‘원본’에서 확인해보세요." : ""}</p>
          )}
          {data && mode === "file" && (
            data.kind === "image"
              ? <img className="sv-image" src={fileUrl} alt={data.filename} />
              : <iframe className="sv-frame" title="원본 PDF" src={`${fileUrl}#page=${page}`} key={page} />
          )}
          {data && !data.has_file && mode === "text" && (
            <p className="lr-muted sv-note">원본 파일이 서버에 없어서(예전에 올린 자료) 글자만 볼 수 있어요. 다시 올리면 원본도 볼 수 있어요.</p>
          )}
        </div>

        {mode === "text" && text && (
          <div className="sv-actions">
            <span className="lr-muted">{sel ? `고른 부분 ${sel.length}자` : "드래그해서 부분만 고를 수 있어요 (안 고르면 페이지 전체)"}</span>
            <span style={{ flex: 1 }} />
            {actions.saveNote && <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => run("note")}><NoteIcon size="1em" /> 노트로 보내기</button>}
            {actions.makeCards && <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => run("cards")}><BookIcon size="1em" /> {busy === "cards" ? "카드 만드는 중…" : "카드 만들기"}</button>}
            {actions.makeQuiz && <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => run("quiz")}><SparkleIcon size="1em" /> {busy === "quiz" ? "퀴즈 만드는 중…" : "퀴즈로 만들기"}</button>}
          </div>
        )}
        {msg && <p className="sv-msg">{msg}</p>}
      </div>
    </div>,
    document.body,
  );
}
