import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiDownload } from "../../api";
import { json } from "./learnApi";
import { DocIcon, SparkleIcon, TrashIcon, TargetIcon } from "../Icons.jsx";
import "./learn.css";

/*
 * 그룹 역량 평가 — 같은 문제로 사전·사후 평가.
 * 그룹장: 자료·문항 수·기간을 정해 만들고, 미리보기에서 고친 뒤 공개, 결과 요약·CSV.
 * 멤버: 기간 안에 응시. 사전 뒤엔 점수만, 사후까지 끝내면 정답·해설과 성장 리포트.
 */

const CONF = [["sure", "확실해요"], ["unsure", "애매해요"], ["guess", "찍었어요"]];
const DIFFS = ["기본", "응용", "심화"];
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const md = (s) => (s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : "");
const range = (a, b) => (b ? `${md(a)} ~ ${md(b)}` : `${md(a)}부터`);
const base = (gid) => `/groups/${gid}/assessments`;

/** 그룹 홈 위쪽 안내: 지금 볼 평가가 있으면 */
export function AssessmentBanner({ groupId, onOpen }) {
  const [todo, setTodo] = useState(null);
  useEffect(() => {
    apiFetch(base(groupId)).then(list => setTodo(list.find(a => a.status === "open" && (a.todo === "pre" || a.todo === "post")) || null)).catch(() => {});
  }, [groupId]);
  if (!todo) return null;
  const close = todo.todo === "pre" ? todo.pre_close : todo.post_close;
  return (
    <div className="callout as-banner">
      <TargetIcon size="1.1em" />
      <span style={{ flex: 1 }}>
        <strong>{todo.title}</strong> {todo.todo === "pre" ? "사전" : "사후"} 평가를 볼 수 있어요{close ? ` (마감 ${md(close)})` : ""}
      </span>
      <button className="btn-primary btn-sm" onClick={onOpen}>평가 보러 가기</button>
    </div>
  );
}

function CreateForm({ groupId, docs, onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState(docs.length === 1 ? [docs[0].doc_id] : []);
  const [n, setN] = useState(10);
  const [preOpen, setPreOpen] = useState(dayKey(0));
  const [preClose, setPreClose] = useState(dayKey(3));
  const [postOpen, setPostOpen] = useState(dayKey(14));
  const [postClose, setPostClose] = useState(dayKey(17));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  async function create() {
    setBusy(true); setError("");
    try {
      const a = await apiFetch(base(groupId), json({ title: title || "역량 평가", doc_ids: picked, n,
        pre_open: preOpen, pre_close: preClose || null, post_open: postOpen, post_close: postClose || null }), 300_000);
      onCreated(a);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="dash-panel as-form">
      <div className="dash-panel-head"><span className="dash-panel-title">새 역량 평가</span></div>
      <div className="as-form-body">
        <p className="lr-muted">자료로 4지선다 문제를 만들어 <strong>같은 문제</strong>로 사전·사후 평가를 봐요. 사전 평가 뒤엔 점수만 보이고 정답은 사후 평가가 끝나야 공개돼요.</p>
        {error && <div className="error-banner"><span>{error}</span></div>}
        <input className="input" placeholder="평가 이름 (예: 자료구조 중간 역량 평가)" value={title} maxLength={60} onChange={e => setTitle(e.target.value)} />
        <p className="lr-label">평가 범위 자료</p>
        <div className="ex-docs">
          {docs.length === 0 && <p className="lr-muted">그룹에 올린 자료가 없어요. 자료 탭에서 먼저 올려주세요.</p>}
          {docs.map(d => (
            <label key={d.doc_id} className={`ex-doc ${picked.includes(d.doc_id) ? "active" : ""}`}>
              <input type="checkbox" checked={picked.includes(d.doc_id)} onChange={() => toggle(d.doc_id)} />
              <DocIcon size="1em" /> {d.filename.replace(/\.pdf$/i, "")}
            </label>
          ))}
        </div>
        <div className="as-form-grid">
          <label>문항 수
            <select className="input" value={n} onChange={e => setN(Number(e.target.value))}>
              {[5, 10, 15, 20].map(v => <option key={v} value={v}>{v}문제</option>)}
            </select>
          </label>
          <label>사전 평가
            <span className="as-dates">
              <input type="date" className="input" value={preOpen} onChange={e => setPreOpen(e.target.value)} aria-label="사전 시작" />~
              <input type="date" className="input" value={preClose} min={preOpen} onChange={e => setPreClose(e.target.value)} aria-label="사전 마감" />
            </span>
          </label>
          <label>사후 평가
            <span className="as-dates">
              <input type="date" className="input" value={postOpen} min={preClose || preOpen} onChange={e => setPostOpen(e.target.value)} aria-label="사후 시작" />~
              <input type="date" className="input" value={postClose} min={postOpen} onChange={e => setPostClose(e.target.value)} aria-label="사후 마감" />
            </span>
          </label>
        </div>
        <p className="lr-muted">난이도는 기본 30% · 응용 40% · 심화 30%로 섞어요. 만든 뒤 미리보기에서 문항을 바꾸거나 뺄 수 있고, ‘공개’해야 멤버에게 보여요.</p>
        <div className="ex-new-foot">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>취소</button>
          <button className="btn-primary" disabled={busy || !picked.length || !preOpen || !postOpen} onClick={create}>
            <SparkleIcon size="1em" /> {busy ? "AI가 문제 만드는 중… (1~2분)" : "문제 만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, pre, post }) {
  return (
    <div className="as-bar">
      <span className="as-bar-label">{label}</span>
      <span className="as-bar-track">
        <span className="as-bar-pre" style={{ width: `${pre ?? 0}%` }} title={`사전 ${pre ?? "-"}%`} />
        <span className="as-bar-post" style={{ width: `${post ?? 0}%` }} title={`사후 ${post ?? "-"}%`} />
      </span>
      <span className="as-bar-num">{pre ?? "-"} → <strong>{post ?? "-"}</strong></span>
    </div>
  );
}

function Report({ groupId, a }) {
  const [rep, setRep] = useState(null);
  const [names, setNames] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch(`${base(groupId)}/${a.id}/report`).then(setRep).catch(e => setError(e.message)); }, [groupId, a.id, a.excluded]);
  const dl = (kind) => apiDownload(`${base(groupId)}/${a.id}/export?kind=${kind}${names && kind === "people" ? "&names=1" : ""}`, `${a.title}_${kind}.csv`)
    .catch(e => setError(e.message));
  if (!rep) return error ? <div className="error-banner"><span>{error}</span></div> : <div className="loading-wrap"><div className="spinner" /></div>;
  return (
    <div className="as-report">
      {error && <div className="error-banner"><span>{error}</span></div>}
      <div className="as-kpis">
        <div><span className="as-kpi">{a.counts?.pre ?? 0}<small>/{a.counts?.members}</small></span><span className="lr-muted">사전 응시</span></div>
        <div><span className="as-kpi">{a.counts?.post ?? 0}</span><span className="lr-muted">사후 응시</span></div>
        <div><span className="as-kpi">{rep.avg_pre ?? "-"}<small>→</small>{rep.avg_post ?? "-"}</span><span className="lr-muted">평균 점수(%, 둘 다 본 {rep.paired}명)</span></div>
        <div><span className="as-kpi">{rep.avg_gain != null ? rep.avg_gain.toFixed(2) : "-"}</span><span className="lr-muted">평균 향상도</span></div>
      </div>
      {rep.paired > 0 && <p className="lr-muted">사전·사후를 모두 본 {rep.paired}명 중 {rep.improved}명이 점수가 올랐어요. 향상도 = (사후 − 사전) ÷ (100 − 사전).</p>}
      <p className="lr-label">난이도별 정답률 (사전 → 사후)</p>
      {DIFFS.map(d => <Bar key={d} label={d} pre={rep.by_diff[d]?.pre} post={rep.by_diff[d]?.post} />)}
      <Bar label="확신 일치" pre={rep.calibration.pre} post={rep.calibration.post} />
      <p className="lr-muted">확신 일치 = ‘확실해요’라고 한 문제는 맞히고, 아니라고 한 문제는 틀린 비율. 오를수록 내가 아는 것과 모르는 것을 정확히 구분해요.</p>
      <p className="lr-label">문항별 정답률</p>
      <div className="as-items">
        {rep.items.map((it, i) => (
          <div key={it.id} className="as-item-row">
            <span className="as-item-no">{i + 1}</span>
            <span className="as-item-q" title={it.question}>{it.question}</span>
            <span className="lr-chip">{it.difficulty}</span>
            <span className="as-item-rate">{it.pre ?? "-"} → <strong>{it.post ?? "-"}</strong></span>
          </div>
        ))}
      </div>
      <div className="as-export">
        <button className="btn-primary btn-sm" onClick={() => dl("people")}>응답자별 CSV</button>
        <button className="btn-secondary btn-sm" onClick={() => dl("items")}>문항별 CSV</button>
        <label className="lr-muted"><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} /> 이름 열 포함 (기본은 익명 번호)</label>
      </div>
      <p className="lr-muted">CSV는 엑셀·구글 시트에서 바로 열려요 (시트: 파일 → 가져오기 → 업로드).</p>
    </div>
  );
}

function Manage({ groupId, aid, onBack, onNotify, onTake }) {
  const [a, setA] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dates, setDates] = useState({});

  useEffect(() => {
    apiFetch(`${base(groupId)}/${aid}`).then(d => { setA(d); setDates({ pre_open: d.pre_open, pre_close: d.pre_close || "", post_open: d.post_open, post_close: d.post_close || "" }); })
      .catch(e => setError(e.message));
  }, [groupId, aid]);

  async function patch(fields, kind = "save") {
    setBusy(kind); setError("");
    try { const d = await apiFetch(`${base(groupId)}/${aid}`, json(fields, "PATCH")); setA(d); return d; }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function replace(qid) {
    setBusy(`q${qid}`); setError("");
    try { setA(await apiFetch(`${base(groupId)}/${aid}/questions/${qid}/replace`, { method: "POST" }, 180_000)); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  if (!a) return error ? <div className="error-banner"><span>{error}</span></div> : <div className="loading-wrap"><div className="spinner" /></div>;
  const excluded = new Set(a.excluded || []);
  return (
    <div className="as-manage">
      <button className="btn-ghost btn-sm" onClick={onBack}>← 평가 목록</button>
      <div className="as-head">
        <h3>{a.title}</h3>
        <span className={`lr-chip ${a.status === "open" ? "" : "lr-chip--why"}`}>{a.status === "open" ? "공개됨" : "미리보기 (멤버에게 안 보임)"}</span>
      </div>
      <p className="lr-muted">자료: {a.docs?.map(d => (d.filename || "삭제된 자료").replace(/\.pdf$/i, "")).join(", ")} · {a.n}문제</p>
      {error && <div className="error-banner"><span>{error}</span><button className="btn-ghost btn-sm" onClick={() => setError("")}>닫기</button></div>}

      {edit ? (
        <div className="as-form-grid as-edit">
          <label>사전 평가<span className="as-dates">
            <input type="date" className="input" value={dates.pre_open} onChange={e => setDates(d => ({ ...d, pre_open: e.target.value }))} />~
            <input type="date" className="input" value={dates.pre_close} onChange={e => setDates(d => ({ ...d, pre_close: e.target.value }))} /></span></label>
          <label>사후 평가<span className="as-dates">
            <input type="date" className="input" value={dates.post_open} onChange={e => setDates(d => ({ ...d, post_open: e.target.value }))} />~
            <input type="date" className="input" value={dates.post_close} onChange={e => setDates(d => ({ ...d, post_close: e.target.value }))} /></span></label>
          <span className="as-edit-btns">
            <button className="btn-ghost btn-sm" onClick={() => setEdit(false)}>취소</button>
            <button className="btn-primary btn-sm" disabled={!!busy} onClick={async () => { if (await patch(dates)) setEdit(false); }}>저장</button>
          </span>
        </div>
      ) : (
        <div className="as-dates-view">
          <span>사전 <strong>{range(a.pre_open, a.pre_close)}</strong></span>
          <span>사후 <strong>{range(a.post_open, a.post_close)}</strong></span>
          <button className="btn-ghost btn-sm" onClick={() => setEdit(true)}>기간 바꾸기</button>
        </div>
      )}

      {a.status === "draft" && (
        <div className="callout as-publish">
          <span style={{ flex: 1 }}>문항을 확인하고 공개하면 멤버들이 사전 평가 기간에 볼 수 있어요. 공개 후 누군가 응시하면 문항은 바꿀 수 없고 ‘채점에서 빼기’만 돼요.</span>
          <button className="btn-primary btn-sm" disabled={!!busy} onClick={async () => {
            const d = await patch({ status: "open" }, "open");
            if (d) onNotify?.("assessment-open", { title: d.title, aid: d.id });
          }}>{busy === "open" ? "공개 중…" : "공개하기"}</button>
        </div>
      )}
      {a.status === "open" && (a.todo === "pre" || a.todo === "post") && (
        <button className="btn-secondary btn-sm as-self" onClick={() => onTake(a, a.todo)}>나도 {a.todo === "pre" ? "사전" : "사후"} 평가 보기</button>
      )}

      {a.status === "open" && <Report groupId={groupId} a={a} />}

      <p className="lr-label">문항 {a.locked ? "(응시가 시작돼서 바꿀 수 없어요)" : ""}</p>
      <div className="as-qlist">
        {a.questions.map((q, i) => (
          <div key={q.id} className={`as-q ${excluded.has(q.id) ? "as-q--excluded" : ""}`}>
            <div className="as-q-top">
              <span className="ex-q-num">{i + 1}</span>
              <span className="as-q-text">{q.question}</span>
            </div>
            <div className="ex-q-tags">
              <span className="lr-chip">{q.difficulty}</span>
              {q.concept && <span className="lr-chip">{q.concept}</span>}
              {q.page && <span className="lr-muted">p.{q.page}</span>}
              {excluded.has(q.id) && <span className="lr-chip lr-chip--due">채점에서 뺌</span>}
            </div>
            <ol className="as-q-opts">
              {q.options.map((o, j) => <li key={j} className={j === q.answer ? "as-correct" : ""}>{o}</li>)}
            </ol>
            {q.explanation && <p className="lr-muted as-q-exp">{q.explanation}</p>}
            <div className="as-q-actions">
              {!a.locked && <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => replace(q.id)}>{busy === `q${q.id}` ? "새 문항 만드는 중…" : "다른 문항으로 바꾸기"}</button>}
              <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => patch({ excluded: excluded.has(q.id) ? [...excluded].filter(x => x !== q.id) : [...excluded, q.id] })}>
                {excluded.has(q.id) ? "다시 채점에 넣기" : "채점에서 빼기"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="ex-danger">
        {confirmDel ? (
          <>
            <span>평가와 모든 응시 기록을 지울까요?</span>
            <button className="btn-danger btn-sm" onClick={async () => { await apiFetch(`${base(groupId)}/${aid}`, { method: "DELETE" }); onBack(true); }}>삭제</button>
            <button className="btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>취소</button>
          </>
        ) : <button className="btn-ghost btn-sm" onClick={() => setConfirmDel(true)}><TrashIcon size="1em" /> 평가 삭제</button>}
      </div>
    </div>
  );
}

function Take({ groupId, a, phase, onDone, onBack }) {
  const [paper, setPaper] = useState(null);
  const [ans, setAns] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    apiFetch(`${base(groupId)}/${a.id}/paper?phase=${phase}`).then(p => { setPaper(p); started.current = Date.now(); }).catch(e => setError(e.message));
  }, [groupId, a.id, phase]);

  const set = (qid, k, v) => setAns(s => ({ ...s, [qid]: { ...(s[qid] || {}), [k]: v } }));
  const answered = paper ? paper.questions.filter(q => ans[q.id]?.c != null).length : 0;

  async function submit() {
    setBusy(true); setError("");
    try {
      const r = await apiFetch(`${base(groupId)}/${a.id}/submit`, json({ phase, answers: ans, seconds: Math.round((Date.now() - started.current) / 1000) }));
      setDone(r);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  if (done) {
    return (
      <div className="as-done">
        <div className="as-done-score">{done.correct}<small>/{done.total}</small></div>
        <p><strong>{phase === "pre" ? "사전" : "사후"} 평가 제출 완료!</strong></p>
        {phase === "pre" ? (
          <p className="lr-muted">정답과 해설은 사후 평가({range(a.post_open, a.post_close)})가 끝나면 공개돼요. 같은 문제가 다시 나오니, 그동안 자료로 공부해보세요.</p>
        ) : <p className="lr-muted">사전 평가와 비교한 성장 리포트를 볼 수 있어요.</p>}
        <button className="btn-primary" onClick={() => onDone(phase)}>{phase === "pre" ? "확인" : "성장 리포트 보기"}</button>
      </div>
    );
  }
  if (!paper) return error ? <div className="error-banner"><span>{error}</span></div> : <div className="loading-wrap"><div className="spinner" /></div>;

  return (
    <div className="as-take">
      <div className="as-take-head">
        <button className="btn-ghost btn-sm" onClick={onBack}>← 나가기</button>
        <strong>{a.title} · {phase === "pre" ? "사전" : "사후"} 평가</strong>
        <span className="lr-muted">{answered}/{paper.questions.length} 답함</span>
      </div>
      <p className="lr-muted">문제마다 답을 고르고, 얼마나 확신하는지도 눌러주세요. 점수에는 답만 들어가요. 자료·검색을 보지 말고 지금 아는 만큼만 풀어야 정확해요.</p>
      {paper.questions.map((q, i) => (
        <div key={q.id} className="as-tq">
          <p className="as-tq-q"><span className="ex-q-num">{i + 1}</span>{q.question}</p>
          <div className="as-tq-opts">
            {q.options.map((o, j) => (
              <button key={o.i} className={`gq-opt ${ans[q.id]?.c === o.i ? "gq-opt--picked as-picked" : ""}`} onClick={() => set(q.id, "c", o.i)}>
                <span className="as-opt-no">{"①②③④"[j]}</span> {o.text}
              </button>
            ))}
          </div>
          <div className="as-conf" role="group" aria-label="확신도">
            {CONF.map(([k, l]) => (
              <button key={k} className={ans[q.id]?.f === k ? "active" : ""} onClick={() => set(q.id, "f", k)}>{l}</button>
            ))}
          </div>
        </div>
      ))}
      {error && <div className="error-banner"><span>{error}</span></div>}
      <div className="as-take-foot">
        {confirm ? (
          <>
            <span className="lr-muted">{answered < paper.questions.length ? `${paper.questions.length - answered}문제를 안 풀었어요. ` : ""}제출하면 다시 풀 수 없어요.</span>
            <button className="btn-ghost" onClick={() => setConfirm(false)}>계속 풀기</button>
            <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? "제출 중…" : "제출"}</button>
          </>
        ) : <button className="btn-primary" onClick={() => setConfirm(true)}>제출하기</button>}
      </div>
    </div>
  );
}

function Result({ groupId, a, onBack }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch(`${base(groupId)}/${a.id}/result`).then(setR).catch(e => setError(e.message)); }, [groupId, a.id]);
  if (!r) return error ? <div className="error-banner"><span>{error}</span></div> : <div className="loading-wrap"><div className="spinner" /></div>;
  if (!r.reveal) {
    return (
      <div className="as-done">
        <button className="btn-ghost btn-sm" onClick={onBack}>← 평가 목록</button>
        <div className="as-done-score">{r.pre?.correct}<small>/{r.pre?.total}</small></div>
        <p className="lr-muted">사전 평가 점수예요. 정답은 사후 평가가 끝나면 공개돼요.</p>
      </div>
    );
  }
  const pick = (q, s) => (s?.c == null ? "(안 풂)" : q.options[s.c]);
  return (
    <div className="as-result">
      <button className="btn-ghost btn-sm" onClick={onBack}>← 평가 목록</button>
      <h3>{a.title} · 성장 리포트</h3>
      <div className="as-kpis">
        <div><span className="as-kpi">{r.pre?.pct ?? "-"}<small>%</small></span><span className="lr-muted">사전</span></div>
        <div><span className="as-kpi">{r.post?.pct ?? "-"}<small>%</small></span><span className="lr-muted">사후</span></div>
        <div><span className="as-kpi">{r.pre && r.post ? `${r.post.pct - r.pre.pct >= 0 ? "+" : ""}${Math.round((r.post.pct - r.pre.pct) * 10) / 10}` : "-"}<small>%p</small></span><span className="lr-muted">변화</span></div>
        <div><span className="as-kpi">{r.gain != null ? r.gain.toFixed(2) : "-"}</span><span className="lr-muted">향상도</span></div>
      </div>
      {DIFFS.map(d => {
        const p = r.pre?.by_diff?.[d], q = r.post?.by_diff?.[d];
        const pct = (x) => (x && x.total ? Math.round(x.correct / x.total * 100) : null);
        return <Bar key={d} label={d} pre={pct(p)} post={pct(q)} />;
      })}
      <Bar label="확신 일치" pre={r.pre?.calibration} post={r.post?.calibration} />
      <p className="lr-label">문항별</p>
      <div className="as-qlist">
        {r.questions.map((q, i) => (
          <div key={q.id} className="as-q">
            <div className="as-q-top">
              <span className="ex-q-num">{i + 1}</span>
              <span className="as-q-text">{q.question}</span>
              <span className="as-marks">
                <span className={q.pre?.ok ? "ok" : "no"}>사전 {q.pre?.ok ? "O" : "X"}</span>
                <span className={q.post?.ok ? "ok" : "no"}>사후 {q.post ? (q.post.ok ? "O" : "X") : "-"}</span>
              </span>
            </div>
            <p className="as-q-ans"><strong>정답</strong> {q.options[q.answer]}</p>
            {(!q.pre?.ok || (q.post && !q.post.ok)) && (
              <p className="lr-muted">내 답: 사전 {pick(q, q.pre)}{q.post ? ` · 사후 ${pick(q, q.post)}` : ""}</p>
            )}
            {q.explanation && <p className="lr-muted as-q-exp">{q.explanation}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 그룹 홈 '평가' 탭 */
export default function Assessments({ groupId, isOwner, docs = [], onNotify }) {
  const [list, setList] = useState(null);
  const [mode, setMode] = useState({ k: "list" });   // list | create | manage | take | result
  const [error, setError] = useState("");
  const load = useCallback(() => apiFetch(base(groupId)).then(setList).catch(e => setError(e.message)), [groupId]);
  useEffect(() => { load(); }, [load]);

  const back = () => { setMode({ k: "list" }); load(); };
  if (mode.k === "create") return <CreateForm groupId={groupId} docs={docs} onCancel={back} onCreated={(a) => setMode({ k: "manage", id: a.id })} />;
  if (mode.k === "manage") return <Manage groupId={groupId} aid={mode.id} onBack={back} onNotify={onNotify} onTake={(a, phase) => setMode({ k: "take", a, phase })} />;
  if (mode.k === "take") return <Take groupId={groupId} a={mode.a} phase={mode.phase} onBack={back}
    onDone={(phase) => (phase === "post" ? setMode({ k: "result", a: mode.a }) : back())} />;
  if (mode.k === "result") return <Result groupId={groupId} a={mode.a} onBack={back} />;

  const status = (a) => {
    if (a.status === "draft") return ["미리보기 · 공개 전", "draft"];
    switch (a.todo) {
      case "pre": return [`사전 평가 응시 가능${a.pre_close ? ` · ${md(a.pre_close)} 마감` : ""}`, "now"];
      case "wait_pre": return [`사전 평가 ${md(a.pre_open)}부터`, "wait"];
      case "wait_post": return [`사전 ${a.my_pre?.pct}% · 사후 평가 ${md(a.post_open)}부터`, "wait"];
      case "post": return [`사후 평가 응시 가능${a.post_close ? ` · ${md(a.post_close)} 마감` : ""}`, "now"];
      case "done": return [`사전 ${a.my_pre?.pct}% → 사후 ${a.my_post?.pct}%`, "done"];
      default: return [a.my_pre ? "사후 평가 기간이 끝났어요" : "사전 평가를 못 봐서 대상이 아니에요", "missed"];
    }
  };

  return (
    <div className="as">
      <div className="gq-head">
        <p className="lr-muted" style={{ margin: 0 }}>같은 문제로 공부 전·후 실력을 재요. 사전 평가 뒤엔 점수만, 사후까지 끝내면 정답과 성장 리포트가 보여요.</p>
        {isOwner && <button className="btn-primary btn-sm" onClick={() => setMode({ k: "create" })}>+ 새 평가</button>}
      </div>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {!list ? <div className="loading-wrap"><div className="spinner" /></div> : list.length === 0 ? (
        <div className="lr-empty-box">
          <p><strong>아직 역량 평가가 없어요.</strong></p>
          <p className="lr-muted">{isOwner ? "그룹 자료로 평가를 만들고 사전·사후 기간을 정해보세요." : "그룹장이 평가를 열면 여기에 나와요."}</p>
        </div>
      ) : (
        <div className="as-list">
          {list.map(a => {
            const [label, tone] = status(a);
            return (
              <div key={a.id} className={`as-card as-card--${tone}`}>
                <div className="as-card-main">
                  <strong>{a.title}</strong>
                  <span className="lr-muted">{a.n}문제 · 사전 {range(a.pre_open, a.pre_close)} · 사후 {range(a.post_open, a.post_close)}</span>
                  <span className="as-card-status">{label}</span>
                  {isOwner && a.counts && <span className="lr-muted">응시 사전 {a.counts.pre} · 사후 {a.counts.post} / 멤버 {a.counts.members}</span>}
                </div>
                <div className="as-card-actions">
                  {(a.todo === "pre" || a.todo === "post") && a.status === "open" && (
                    <button className="btn-primary btn-sm" onClick={() => setMode({ k: "take", a, phase: a.todo })}>{a.todo === "pre" ? "사전" : "사후"} 평가 보기</button>
                  )}
                  {(a.todo === "done" || (a.my_pre && a.post_window === "closed")) && (
                    <button className="btn-secondary btn-sm" onClick={() => setMode({ k: "result", a })}>성장 리포트</button>
                  )}
                  {a.todo === "wait_post" && <button className="btn-ghost btn-sm" onClick={() => setMode({ k: "result", a })}>내 사전 점수</button>}
                  {isOwner && <button className="btn-ghost btn-sm" onClick={() => setMode({ k: "manage", id: a.id })}>관리·결과</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
