import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { generateCards, json } from "./learnApi";
import { BookIcon, DocIcon, NoteIcon, PencilIcon, TrashIcon, SparkleIcon } from "../Icons.jsx";
import "./learn.css";

const GRADE_LABELS = [["다시", "again"], ["어려움", "hard"], ["알맞음", "good"], ["쉬움", "easy"]];
export const fmtInterval = (d) => (d <= 0 ? "10분" : d < 30 ? `${d}일` : d < 365 ? `${Math.round(d / 30)}달` : "1년");

/** 카드 복습: 앞면 → 답 보기 → 다시/어려움/알맞음/쉬움. 키보드: Space 뒤집기, 1~4 평가 */
export function ReviewSession({ cards: initial, onExit, onOpenSource, onDeleted }) {
  const [queue, setQueue] = useState(initial);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState({ total: 0, again: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = queue[0];

  const grade = useCallback(async (g) => {
    if (!card || busy) return;
    setBusy(true); setError("");
    try {
      const updated = await apiFetch(`/learn/cards/${card.id}/review`, json({ grade: g }));
      setDone(d => ({ total: d.total + 1, again: d.again + (g === 0 ? 1 : 0) }));
      // '다시'는 이번 복습 끝에 한 번 더
      setQueue(q => (g === 0 ? [...q.slice(1), updated] : q.slice(1)));
      setFlipped(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [card, busy]);

  async function removeCard() {
    if (!card || busy) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/learn/cards/${card.id}`, { method: "DELETE" });
      setQueue(q => q.filter(c => c.id !== card.id));
      setFlipped(false);
      onDeleted?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const key = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
      if (flipped && ["1", "2", "3", "4"].includes(e.key)) grade(Number(e.key) - 1);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [flipped, grade]);

  if (!card) {
    return (
      <div className="fc-finish">
        <div className="fc-finish-icon"><SparkleIcon size="1.6em" /></div>
        <p><strong>오늘 복습 끝!</strong> {done.total}장 복습했어요{done.again ? ` (다시 본 카드 ${done.again}장)` : ""}.</p>
        <p className="lr-muted">잊어버릴 때쯤 다시 보여줄게요. 카드 결과는 약점 지도에도 반영돼요.</p>
        <button className="btn-primary" onClick={onExit}>돌아가기</button>
      </div>
    );
  }

  const pct = Math.round(done.total / (done.total + queue.length) * 100);
  return (
    <div className="fc-session">
      <div className="fc-progress"><span style={{ width: `${pct}%` }} /></div>
      <div className="fc-session-head">
        <span className="lr-muted">남은 카드 {queue.length}장 · 복습 {done.total}장</span>
        <span>
          <button className="btn-ghost btn-sm" disabled={busy} onClick={removeCard} title="이 카드를 지워요">
            <TrashIcon size="1em" /> 이 카드 삭제
          </button>
          <button className="btn-ghost btn-sm" onClick={onExit}>그만하기</button>
        </span>
      </div>
      <button className={`fc-card ${flipped ? "fc-card--flipped" : ""}`} onClick={() => setFlipped(f => !f)}
        aria-label={flipped ? "앞면 보기" : "답 보기"}>
        {card.concept && <span className="fc-concept">{card.concept}</span>}
        <span className="fc-front">{card.front}</span>
        {flipped && <span className="fc-back">{card.back}</span>}
        {!flipped && <span className="fc-hint">눌러서 답 보기 (Space)</span>}
      </button>
      {flipped && card.page && card.doc_id && onOpenSource && (
        <button className="lr-link" onClick={() => onOpenSource(card.doc_id, card.page)}>근거 보기 · p.{card.page}</button>
      )}
      {error && <div className="error-banner"><span>{error}</span></div>}
      {flipped ? (
        <div className="fc-grades">
          {GRADE_LABELS.map(([label, cls], g) => (
            <button key={cls} className={`fc-grade fc-grade--${cls}`} disabled={busy} onClick={() => grade(g)}>
              <span>{label}</span><small>{fmtInterval(card.next?.[g] ?? 0)} 뒤 · {g + 1}</small>
            </button>
          ))}
        </div>
      ) : (
        <button className="btn-primary fc-show" onClick={() => setFlipped(true)}>답 보기</button>
      )}
    </div>
  );
}

function CardRow({ c, onSave, onDelete, onOpenSource }) {
  const [edit, setEdit] = useState(false);
  const [front, setFront] = useState(c.front);
  const [back, setBack] = useState(c.back);
  if (edit) {
    return (
      <div className="fc-row fc-row--edit">
        <textarea className="input" rows={2} value={front} onChange={e => setFront(e.target.value)} aria-label="앞면" />
        <textarea className="input" rows={3} value={back} onChange={e => setBack(e.target.value)} aria-label="뒷면" />
        <div className="fc-row-actions">
          <button className="btn-ghost btn-sm" onClick={() => setEdit(false)}>취소</button>
          <button className="btn-primary btn-sm" onClick={async () => { await onSave(c.id, { front, back }); setEdit(false); }}>저장</button>
        </div>
      </div>
    );
  }
  return (
    <div className="fc-row">
      <div className="fc-row-main">
        <span className="fc-row-front">{c.front}</span>
        <span className="fc-row-back">{c.back}</span>
        <span className="fc-row-meta">
          {c.concept && <span className="lr-chip">{c.concept}</span>}
          {c.is_due ? <span className="lr-chip lr-chip--due">오늘 복습</span> : <span className="lr-muted">다음 복습 {new Date(c.due + (c.due?.endsWith("Z") ? "" : "Z")).toLocaleDateString("ko-KR")}</span>}
          {c.page && c.doc_id && onOpenSource && <button className="lr-link" onClick={() => onOpenSource(c.doc_id, c.page)}>p.{c.page}</button>}
        </span>
      </div>
      <button className="lr-icon-btn" onClick={() => setEdit(true)} aria-label="카드 고치기"><PencilIcon size="1em" /></button>
      <button className="lr-icon-btn" onClick={() => onDelete(c.id)} aria-label="카드 지우기"><TrashIcon size="1em" /></button>
    </div>
  );
}

/** 자료(또는 노트) 하나의 카드: 복습 시작, AI로 만들기, 직접 추가, 목록 */
export function CardDeck({ docId, noteId, etc = false, refreshKey = 0, onOpenSource, onToast, onChanged, compact = false }) {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(8);
  const [session, setSession] = useState(null);
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const q = docId ? `doc_id=${docId}` : noteId ? `note_id=${noteId}` : "";

  const load = useCallback(() => apiFetch(`/learn/cards?${q}`)
    .then(cs => setCards(etc ? cs.filter(c => !c.doc_id && !c.note_id) : cs))
    .catch(e => setError(e.message)), [q, etc]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function generate() {
    setBusy(true); setError("");
    try {
      const made = await generateCards({ doc_id: docId || null, note_id: noteId || null, n });
      setCards(cs => [...made, ...(cs || [])]);
      onToast?.(`카드 ${made.length}장을 만들었어요`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function add() {
    if (!front.trim() || !back.trim()) return;
    try {
      const c = await apiFetch("/learn/cards", json({ front, back, doc_id: docId || null, note_id: noteId || null }));
      setCards(cs => [c, ...(cs || [])]);
      setFront(""); setBack(""); setAdding(false);
    } catch (e) { setError(e.message); }
  }

  const save = async (id, fields) => {
    const c = await apiFetch(`/learn/cards/${id}`, json(fields, "PATCH"));
    setCards(cs => cs.map(x => (x.id === id ? c : x)));
  };
  const remove = async (id) => {
    try {
      await apiFetch(`/learn/cards/${id}`, { method: "DELETE" });
      setCards(cs => cs.filter(x => x.id !== id));
      onChanged?.();
    } catch (e) { setError(e.message); }
  };
  async function removeAll() {
    try {
      const r = await apiFetch(`/learn/cards?${etc ? "etc=1" : q}`, { method: "DELETE" });
      setCards([]); setConfirmAll(false);
      onToast?.(`카드 ${r.deleted}장을 지웠어요`);
      onChanged?.();
    } catch (e) { setError(e.message); }
  }

  if (session) return <ReviewSession cards={session} onOpenSource={onOpenSource} onDeleted={onChanged}
    onExit={() => { setSession(null); load(); onChanged?.(); }} />;
  if (!cards) return error ? <div className="error-banner"><span>{error}</span></div> : <div className="loading-wrap"><div className="spinner" /></div>;

  const due = cards.filter(c => c.is_due);
  return (
    <div className="fc-deck">
      <div className={`fc-deck-head ${compact ? "fc-deck-head--compact" : ""}`}>
        <div>
          <strong className="fc-deck-count">{due.length}장</strong> 오늘 복습 · 전체 {cards.length}장
        </div>
        <button className="btn-primary" disabled={!due.length} onClick={() => setSession(due)}>
          {due.length ? `복습 시작 (${due.length})` : "오늘 복습 끝"}
        </button>
      </div>
      {error && <div className="error-banner"><span>{error}</span><button className="btn-ghost btn-sm" onClick={() => setError("")}>닫기</button></div>}
      <div className="fc-tools">
        <button className="btn-secondary btn-sm" disabled={busy} onClick={generate}>
          <SparkleIcon size="1em" /> {busy ? "AI가 카드 만드는 중… (최대 1분)" : `AI로 카드 ${n}장 만들기`}
        </button>
        <select className="input fc-n" value={n} onChange={e => setN(Number(e.target.value))} aria-label="만들 카드 수">
          {[5, 8, 12, 20].map(v => <option key={v} value={v}>{v}장</option>)}
        </select>
        <button className="btn-ghost btn-sm" onClick={() => setAdding(a => !a)}><PencilIcon size="1em" /> 직접 추가</button>
        {cards.length > 0 && (confirmAll ? (
          <span className="fc-confirm">
            카드 {cards.length}장을 모두 지울까요?
            <button className="btn-danger btn-sm" onClick={removeAll}>모두 삭제</button>
            <button className="btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>취소</button>
          </span>
        ) : (
          <button className="btn-ghost btn-sm fc-delall" onClick={() => setConfirmAll(true)}><TrashIcon size="1em" /> 전체 삭제</button>
        ))}
      </div>
      {adding && (
        <div className="fc-row fc-row--edit">
          <textarea className="input" rows={2} placeholder="앞면 (질문·용어)" value={front} onChange={e => setFront(e.target.value)} />
          <textarea className="input" rows={3} placeholder="뒷면 (답)" value={back} onChange={e => setBack(e.target.value)} />
          <div className="fc-row-actions">
            <button className="btn-ghost btn-sm" onClick={() => setAdding(false)}>취소</button>
            <button className="btn-primary btn-sm" disabled={!front.trim() || !back.trim()} onClick={add}>추가</button>
          </div>
        </div>
      )}
      {cards.length === 0 ? (
        <div className="lr-empty-box">
          <p><strong>아직 카드가 없어요.</strong></p>
          <p className="lr-muted">AI가 {docId ? "자료" : "노트"}에서 외울 것을 앞·뒷면 카드로 만들어줘요. 잊어버릴 때쯤 다시 보여주는 방식(간격 반복)으로 복습해요.</p>
        </div>
      ) : (
        <div className="fc-list">
          {cards.map(c => <CardRow key={c.id} c={c} onSave={save} onDelete={remove} onOpenSource={onOpenSource} />)}
        </div>
      )}
    </div>
  );
}

/** 사이드바 '플래시카드': 오늘 복습할 카드 전체 + 자료·노트별 묶음 */
export default function FlashcardsPage({ onOpenDoc, onOpenNote, onOpenSource, onChanged }) {
  const [sum, setSum] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState(null);   // 카드 목록을 펼친 묶음
  const [confirmKey, setConfirmKey] = useState(null);

  const load = useCallback(() => apiFetch("/learn/cards/summary").then(setSum).catch(e => setError(e.message)), []);
  const changed = () => { load(); onChanged?.(); };

  async function removeGroup(g) {
    setError("");
    try {
      const qs = g.kind === "doc" ? `doc_id=${g.id}` : g.kind === "note" ? `note_id=${g.id}` : "etc=1";
      await apiFetch(`/learn/cards?${qs}`, { method: "DELETE" });
      setConfirmKey(null);
      if (openKey === g.key) setOpenKey(null);
      changed();
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [load]);

  async function start(group) {
    setError("");
    try {
      const qs = group ? (group.kind === "doc" ? `&doc_id=${group.id}` : group.kind === "note" ? `&note_id=${group.id}` : "") : "";
      const cards = (await apiFetch(`/learn/cards?due=1${qs}`)).filter(c => group?.kind !== "etc" || (!c.doc_id && !c.note_id));
      if (cards.length) setSession(cards);
    } catch (e) { setError(e.message); }
  }

  if (session) return <ReviewSession cards={session} onOpenSource={onOpenSource} onDeleted={changed} onExit={() => { setSession(null); changed(); }} />;

  return (
    <div className="fc-page">
      <h1 className="page-title">플래시카드</h1>
      <p className="lr-muted fc-page-intro">외울 것을 카드로 만들고, 잊어버릴 때쯤 다시 보여줘요. 자료의 ‘카드’ 탭이나 노트에서 AI로 만들 수 있어요.</p>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {!sum ? <div className="loading-wrap"><div className="spinner" /></div> : (
        <>
          <div className="fc-hero">
            <div>
              <div className="fc-hero-num">{sum.due}<small>장</small></div>
              <div className="lr-muted">오늘 복습할 카드 · 전체 {sum.total}장</div>
            </div>
            <button className="btn-primary" disabled={!sum.due} onClick={() => start(null)}>
              {sum.due ? "전체 복습 시작" : "오늘 복습 끝!"}
            </button>
          </div>
          {sum.groups.length === 0 ? (
            <div className="lr-empty-box">
              <p><strong>아직 카드가 없어요.</strong></p>
              <p className="lr-muted">강의자료를 열고 ‘카드’ 탭에서 “AI로 카드 만들기”를 눌러보세요.</p>
            </div>
          ) : (
            <div className="dash-panel">
              <div className="dash-doc-table">
                {sum.groups.map(g => (
                  <div key={g.key} className="fc-group">
                    <div className="dash-doc-row fc-group-row">
                      <button className="dash-doc-main" onClick={() => setOpenKey(k => (k === g.key ? null : g.key))}
                        aria-expanded={openKey === g.key} title="카드 목록 보기">
                        <span className="fc-caret">{openKey === g.key ? "▾" : "▸"}</span>
                        {g.kind === "doc" ? <DocIcon size="1em" /> : g.kind === "note" ? <NoteIcon size="1em" /> : <BookIcon size="1em" />}
                        <span className="dash-doc-name">{g.label.replace(/\.pdf$/i, "")}</span>
                      </button>
                      <span className="lr-muted">{g.total}장</span>
                      {g.kind !== "etc" && (
                        <button className="btn-ghost btn-sm" onClick={() => (g.kind === "doc" ? onOpenDoc?.(g.id, g.label) : onOpenNote?.(g.id))}>
                          {g.kind === "doc" ? "자료 열기" : "노트 열기"}
                        </button>
                      )}
                      <button className="btn-secondary btn-sm" disabled={!g.due} onClick={() => start(g)}>
                        {g.due ? `복습 ${g.due}` : "완료"}
                      </button>
                      <button className="lr-icon-btn" onClick={() => setConfirmKey(g.key)} aria-label={`${g.label} 카드 모두 삭제`} title="이 묶음 카드 모두 삭제">
                        <TrashIcon size="1em" />
                      </button>
                    </div>
                    {confirmKey === g.key && (
                      <div className="fc-confirm fc-confirm--row">
                        “{g.label.replace(/\.pdf$/i, "")}” 카드 {g.total}장을 모두 지울까요? (자료·노트는 그대로예요)
                        <button className="btn-danger btn-sm" onClick={() => removeGroup(g)}>모두 삭제</button>
                        <button className="btn-ghost btn-sm" onClick={() => setConfirmKey(null)}>취소</button>
                      </div>
                    )}
                    {openKey === g.key && (
                      <div className="fc-group-body">
                        <CardDeck compact docId={g.kind === "doc" ? g.id : null} noteId={g.kind === "note" ? g.id : null}
                          etc={g.kind === "etc"} onOpenSource={onOpenSource} onChanged={changed} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
