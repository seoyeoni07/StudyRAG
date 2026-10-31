import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { json } from "./learnApi";
import { PencilIcon, TrashIcon, SparkleIcon } from "../Icons.jsx";
import "./learn.css";

function Review({ r }) {
  if (!r) return <span className="lr-muted gq-review-wait">AI가 문제를 검토하는 중…</span>;
  if (r.error) return <span className="lr-muted">{r.error}</span>;
  return (
    <div className={`gq-review ${r.answer_ok ? "" : "gq-review--bad"}`}>
      <span className="gq-stars" aria-label={`품질 ${r.score}점`}>{"★".repeat(r.score)}{"☆".repeat(5 - r.score)}</span>
      <span>{r.answer_ok ? r.verdict : `정답 확인 필요 · ${r.verdict}`}</span>
      {r.comments?.length > 0 && <ul>{r.comments.map((c, i) => <li key={i}>{c}</li>)}</ul>}
    </div>
  );
}

function QuestionCard({ q, me, isOwner, groupId, onChanged }) {
  const [ans, setAns] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const mine = q.author_id === me;
  const done = q.my_attempt || result;

  async function submit(value = ans) {
    if (!value.trim()) return;
    setBusy(true); setError("");
    try {
      const r = await apiFetch(`/groups/${groupId}/questions/${q.id}/attempt`, json({ answer: value }), 120_000);
      setResult(r);
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const shown = result || (q.my_attempt && { ...q.my_attempt, answer: q.answer, explanation: q.explanation });
  return (
    <div className="gq-card">
      <div className="gq-top">
        <span className="gq-author">{q.author_name}{mine && " (나)"}</span>
        {q.concept && <span className="lr-chip">{q.concept}</span>}
        <span className="lr-muted">{q.attempts > 0 ? `${q.attempts}명 풂 · 정답률 ${Math.round(q.correct_rate * 100)}%` : "아직 아무도 안 풂"}</span>
        {(mine || isOwner) && (
          <button className="lr-icon-btn" aria-label="문제 지우기" onClick={async () => {
            await apiFetch(`/groups/${groupId}/questions/${q.id}`, { method: "DELETE" }); onChanged?.(true);
          }}><TrashIcon size="1em" /></button>
        )}
      </div>
      <p className="gq-q">{q.question}</p>

      {q.type === "mc" && q.options && (
        <div className="gq-opts">
          {q.options.map(o => {
            const correct = shown?.answer ?? (mine ? q.answer : null);
            const myPick = result ? ans : q.my_attempt?.answer;
            const cls = o === correct ? "gq-opt--answer" : done && o === myPick ? "gq-opt--wrong" : busy && ans === o ? "gq-opt--picked" : "";
            return (
              <button key={o} className={`gq-opt ${cls}`} disabled={mine || done || busy}
                onClick={() => { setAns(o); submit(o); }}>{o}</button>
            );
          })}
        </div>
      )}
      {q.type !== "mc" && !mine && !done && (
        <div className="gq-answer-row">
          <input className="input" placeholder="내 답" value={ans} onChange={e => setAns(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && submit()} />
          <button className="btn-primary btn-sm" disabled={busy || !ans.trim()} onClick={() => submit()}>{busy ? "채점 중…" : "제출"}</button>
        </div>
      )}
      {error && <div className="error-banner"><span>{error}</span></div>}

      {shown && (
        <div className={`gq-result ${shown.correct ? "ok" : "no"}`}>
          <strong>{shown.correct ? "정답!" : "아쉬워요"}</strong>
          {q.type !== "mc" && <span> 정답: {shown.answer}</span>}
          {shown.feedback && <p className="lr-muted">{shown.feedback}</p>}
          {shown.explanation && <p className="lr-muted">{shown.explanation}</p>}
        </div>
      )}
      {mine && (
        <div className="gq-mine">
          <p className="lr-muted">정답: {q.answer}{q.explanation ? ` · ${q.explanation}` : ""}</p>
          <Review r={q.ai_review} />
        </div>
      )}
      {!mine && done && q.ai_review && !q.ai_review.error && (
        <p className="lr-muted gq-score">AI 문제 품질 {"★".repeat(q.ai_review.score)}</p>
      )}
    </div>
  );
}

function NewQuestion({ groupId, docs, onCreated, onCancel }) {
  const [type, setType] = useState("mc");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [concept, setConcept] = useState("");
  const [docId, setDocId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const opts = options.map(o => o.trim()).filter(Boolean);
  const ok = question.trim() && (type === "mc" ? opts.length >= 2 && opts.includes(answer) : answer.trim());

  async function create() {
    setBusy(true); setError("");
    try {
      const q = await apiFetch(`/groups/${groupId}/questions`, json({
        type, question, options: type === "mc" ? opts : null, answer, explanation, concept, doc_id: docId || null,
      }));
      onCreated(q);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="gq-new">
      <div className="lr-seg">
        <button className={type === "mc" ? "active" : ""} onClick={() => { setType("mc"); setAnswer(""); }}>객관식</button>
        <button className={type === "short" ? "active" : ""} onClick={() => { setType("short"); setAnswer(""); }}>단답·서술</button>
      </div>
      <textarea className="input" rows={2} placeholder="문제" value={question} maxLength={3000} onChange={e => setQuestion(e.target.value)} />
      {type === "mc" ? (
        <div className="gq-new-opts">
          {options.map((o, i) => (
            <label key={i} className="gq-new-opt">
              <input type="radio" name="gq-answer" checked={!!o.trim() && answer === o.trim()} disabled={!o.trim()}
                onChange={() => setAnswer(o.trim())} aria-label={`${i + 1}번을 정답으로`} />
              <input className="input" placeholder={`선택지 ${i + 1}`} value={o}
                onChange={e => { const v = e.target.value; setOptions(p => p.map((x, j) => (j === i ? v : x))); if (answer === o.trim()) setAnswer(v.trim()); }} />
            </label>
          ))}
          <span className="lr-muted">동그라미를 눌러 정답을 고르세요.</span>
        </div>
      ) : (
        <input className="input" placeholder="정답 (모범 답안)" value={answer} onChange={e => setAnswer(e.target.value)} />
      )}
      <input className="input" placeholder="해설 (선택)" value={explanation} onChange={e => setExplanation(e.target.value)} />
      <div className="gq-new-row">
        <input className="input" placeholder="개념 (선택, 예: 스택)" value={concept} maxLength={60} onChange={e => setConcept(e.target.value)} />
        <select className="input" value={docId} onChange={e => setDocId(e.target.value)} aria-label="관련 자료">
          <option value="">관련 자료 (선택)</option>
          {docs.map(d => <option key={d.doc_id} value={d.doc_id}>{d.filename}</option>)}
        </select>
      </div>
      {error && <div className="error-banner"><span>{error}</span></div>}
      <div className="gq-new-foot">
        <span className="lr-muted">올리면 AI가 정답이 맞는지·문제가 좋은지 검토해서 나에게만 알려줘요.</span>
        <button className="btn-ghost btn-sm" onClick={onCancel}>취소</button>
        <button className="btn-primary btn-sm" disabled={!ok || busy} onClick={create}>문제 올리기</button>
      </div>
    </div>
  );
}

/** 그룹 홈 '문제' 탭: 서로 문제 내고 풀기 */
export function PeerQuestions({ groupId, me, isOwner, docs = [], onNotify }) {
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("todo");
  const [error, setError] = useState("");

  const load = useCallback(() => apiFetch(`/groups/${groupId}/questions`).then(setList).catch(e => setError(e.message)), [groupId]);
  useEffect(() => { load(); }, [load]);
  // AI 검토는 뒤에서 붙는다 — 내 문제가 검토 대기 중이면 잠깐씩 다시 불러온다
  const waiting = list?.some(q => q.author_id === me && !q.ai_review);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [waiting, load]);

  if (!list) return error ? <div className="error-banner"><span>{error}</span></div> : <div className="loading-wrap"><div className="spinner" /></div>;
  const shown = list.filter(q => filter === "all" || (filter === "todo" ? q.author_id !== me && !q.my_attempt : filter === "mine" ? q.author_id === me : !!q.my_attempt));
  const counts = {
    todo: list.filter(q => q.author_id !== me && !q.my_attempt).length,
    mine: list.filter(q => q.author_id === me).length,
    done: list.filter(q => q.my_attempt).length,
  };

  return (
    <div className="gq">
      <div className="gq-head">
        <div className="lr-legend">
          {[["todo", "안 푼 문제"], ["done", "푼 문제"], ["mine", "내가 낸 문제"], ["all", "전체"]].map(([k, l]) => (
            <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{l}{k !== "all" ? ` ${counts[k]}` : ""}</button>
          ))}
        </div>
        {!creating && <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><PencilIcon size="1em" /> 문제 내기</button>}
      </div>
      {creating && (
        <NewQuestion groupId={groupId} docs={docs} onCancel={() => setCreating(false)}
          onCreated={(q) => { setCreating(false); setList(l => [q, ...l]); setFilter("mine"); onNotify?.(); }} />
      )}
      {shown.length === 0 ? (
        <div className="lr-empty-box">
          <p><strong>{filter === "todo" ? "풀 문제가 없어요." : "문제가 없어요."}</strong></p>
          <p className="lr-muted">공부한 내용으로 문제를 내보세요. 문제를 내는 것 자체가 가장 좋은 복습이에요.</p>
        </div>
      ) : (
        <div className="gq-list">
          {shown.map(q => <QuestionCard key={q.id} q={q} me={me} isOwner={isOwner} groupId={groupId}
            onChanged={(removed) => { load(); if (removed) onNotify?.(); }} />)}
        </div>
      )}
    </div>
  );
}

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);

/** 그룹 홈 '랭킹' 탭: 이번 주 공부 시간·문제 */
export function GroupRanking({ groupId, me }) {
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d); });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let off = false;
    setData(null);
    apiFetch(`/groups/${groupId}/ranking?start=${start}`).then(d => !off && setData(d)).catch(e => !off && setError(e.message));
    return () => { off = true; };
  }, [groupId, start]);

  const shift = (n) => { const d = new Date(start + "T00:00:00"); d.setDate(d.getDate() + n * 7); setStart(keyOf(d)); };
  const max = Math.max(60, ...(data?.rows || []).map(r => r.minutes));
  const WD = ["월", "화", "수", "목", "금", "토", "일"];

  return (
    <div className="rk">
      <div className="rk-head">
        <button className="btn-ghost btn-sm" onClick={() => shift(-1)} aria-label="지난주">‹</button>
        <strong>{data ? `${data.start.slice(5).replace("-", ".")} ~ ${data.end.slice(5).replace("-", ".")}` : "…"}</strong>
        <button className="btn-ghost btn-sm" onClick={() => shift(1)} aria-label="다음 주">›</button>
      </div>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {!data ? <div className="loading-wrap"><div className="spinner" /></div> : (
        <div className="rk-list">
          {data.rows.map(r => (
            <div key={r.user_id} className={`rk-row ${r.user_id === me ? "rk-row--me" : ""}`}>
              <span className={`rk-rank rk-rank--${r.rank}`}>{r.rank}</span>
              <div className="rk-main">
                <div className="rk-name">{r.name}{r.user_id === me && " (나)"} <span className="rk-points">{r.points}점</span></div>
                <div className="rk-bar"><span style={{ width: `${r.minutes / max * 100}%` }} /></div>
                <div className="rk-meta lr-muted">
                  공부 {fmtMin(r.minutes)} · 끝낸 할 일 {r.tasks_done} · 맞힌 문제 {r.correct}/{r.solved} · 낸 문제 {r.made}
                </div>
              </div>
              <div className="rk-days" aria-label="요일별 공부 시간">
                {r.daily.map((m, i) => <span key={i} title={`${WD[i]} ${fmtMin(m)}`} style={{ opacity: m ? Math.min(1, 0.25 + m / 240) : 0.08 }} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="lr-muted rk-foot">
        <SparkleIcon size="0.9em" /> 공부 시간은 각자 개인 플래너 시간표에 ‘실제’로 칠한 시간이에요 (합계만 보여요).
        점수 = 공부 1시간 10점 + 맞힌 문제 2점 + 낸 문제 3점 + 끝낸 할 일 1점.
      </p>
    </div>
  );
}
