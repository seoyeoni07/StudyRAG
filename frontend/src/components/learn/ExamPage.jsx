import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiFetch } from "../../api";
import { json } from "./learnApi";
import { DocIcon, TargetIcon, TrashIcon, UploadIcon, SparkleIcon, WarningIcon } from "../Icons.jsx";
import "./learn.css";

const Md = ({ children }) => <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{children || ""}</ReactMarkdown>;

export function ddayOf(dateStr) {
  if (!dateStr) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const n = Math.round((d - t) / 86400000);
  return n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`;
}

function NewPrep({ docs, onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  async function create() {
    setBusy(true); setError("");
    try { onCreated(await apiFetch("/exam", json({ title: title || "시험 대비", doc_ids: picked, exam_date: date || null }))); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <div className="dash-panel ex-new">
      <div className="dash-panel-head"><span className="dash-panel-title">새 시험 대비</span></div>
      <div className="ex-new-body">
        {error && <div className="error-banner"><span>{error}</span></div>}
        <div className="ex-new-row">
          <input className="input" placeholder="이름 (예: 자료구조 중간고사)" value={title} maxLength={60} onChange={e => setTitle(e.target.value)} />
          <label className="ex-date">시험일 <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <p className="lr-label">시험 범위 자료 (여러 개 고를 수 있어요)</p>
        <div className="ex-docs">
          {docs.length === 0 && <p className="lr-muted">먼저 강의자료를 올려주세요.</p>}
          {docs.map(d => (
            <label key={d.doc_id} className={`ex-doc ${picked.includes(d.doc_id) ? "active" : ""}`}>
              <input type="checkbox" checked={picked.includes(d.doc_id)} onChange={() => toggle(d.doc_id)} />
              <DocIcon size="1em" /> {d.filename.replace(/\.pdf$/i, "")}
              {d.group && <span className="lr-chip">{d.group}</span>}
            </label>
          ))}
        </div>
        <div className="ex-new-foot">
          <button className="btn-ghost" onClick={onCancel}>취소</button>
          <button className="btn-primary" disabled={busy || !picked.length} onClick={create}>만들기</button>
        </div>
      </div>
    </div>
  );
}

function Predicted({ data, singleDocId, onOpenSource }) {
  const [open, setOpen] = useState({});
  return (
    <div className="ex-qs">
      {data.questions.map((q, i) => (
        <div key={i} className="ex-q">
          <div className="ex-q-top">
            <span className="ex-q-num">{i + 1}</span>
            <span className="ex-q-text"><Md>{q.question}</Md></span>
          </div>
          <div className="ex-q-tags">
            {q.why && <span className="lr-chip lr-chip--why">{q.why}</span>}
            {q.concept && <span className="lr-chip">{q.concept}</span>}
            {q.page && singleDocId && <button className="lr-link" onClick={() => onOpenSource(singleDocId, q.page)}>근거 p.{q.page}</button>}
          </div>
          {q.options && <ol className="ex-q-opts">{q.options.map((o, j) => <li key={j}>{o}</li>)}</ol>}
          {open[i] ? (
            <div className="ex-q-answer">
              <p><strong>정답</strong> {q.answer}</p>
              {q.explanation && <div className="lr-muted"><Md>{q.explanation}</Md></div>}
            </div>
          ) : (
            <button className="btn-ghost btn-sm" onClick={() => setOpen(o => ({ ...o, [i]: true }))}>정답·해설 보기</button>
          )}
        </div>
      ))}
    </div>
  );
}

function Mistakes({ prepId, onOpenDoc }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { apiFetch(`/exam/${prepId}/mistakes`).then(setData).catch(() => setData({ groups: [], weak: [], total: 0 })); }, [prepId]);
  if (!data) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!data.total && !data.weak.length) {
    return <div className="lr-empty-box"><p><strong>아직 틀린 문제가 없어요.</strong></p><p className="lr-muted">시험 범위 자료로 퀴즈를 풀면 자주 틀린 개념을 여기 모아줘요.</p></div>;
  }
  return (
    <div className="ex-mistakes">
      {data.weak.length > 0 && (
        <div className="ex-weak">
          <p className="lr-label">아직 약한 개념</p>
          <div className="ex-weak-list">
            {data.weak.map(w => (
              <button key={w.doc_id + w.concept} className={`ex-weak-chip lr-concept--${w.level}`} onClick={() => onOpenDoc(w.doc_id, w.filename, "mastery")}>
                <span className={`lr-dot lr-lv-${w.level}`} />{w.concept} <small>{Math.round(w.score * 100)}%</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {data.groups.map(g => (
        <div key={g.concept} className="ex-mgroup">
          <button className="ex-mgroup-head" onClick={() => setOpen(o => (o === g.concept ? null : g.concept))} aria-expanded={open === g.concept}>
            <strong>{g.concept}</strong>
            <span className="lr-chip lr-chip--due">{g.count}번 틀림</span>
            {g.open > 0 && <span className="lr-muted">복습 안 한 것 {g.open}</span>}
            <span className="ex-caret">{open === g.concept ? "▾" : "▸"}</span>
          </button>
          {open === g.concept && g.items.map(it => (
            <div key={it.id} className="ex-mitem">
              <p className="ex-mitem-q"><Md>{it.question}</Md></p>
              <p><span className="ex-wrong">내 답 {it.user_answer || "(빈칸)"}</span> → <strong>정답 {it.correct_answer}</strong></p>
              {it.explanation && <div className="lr-muted"><Md>{it.explanation}</Md></div>}
              {it.filename && <button className="lr-link" onClick={() => onOpenDoc(it.doc_id, it.filename, "wrong")}>{it.filename.replace(/\.pdf$/i, "")} 오답노트 열기</button>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PastAnalysis({ prep, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);
  const pa = prep.past_analysis;

  async function upload(file) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await apiFetch(`/exam/${prep.id}/past`, { method: "POST", body: form }, 240_000);
      onUpdated({ ...prep, ...r });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  const max = Math.max(1, ...(pa?.topics || []).map(t => t.count));
  return (
    <div className="ex-past">
      <div className="ex-past-upload">
        <input ref={input} type="file" accept=".pdf,image/*" hidden onChange={e => upload(e.target.files?.[0])} />
        <button className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
          <UploadIcon size="1em" /> {busy ? "기출 읽고 분석하는 중… (1~2분)" : pa ? "다른 기출로 다시 분석" : "기출문제 올리기 (PDF·사진)"}
        </button>
        <span className="lr-muted">{prep.past_filename ? `분석한 파일: ${prep.past_filename}` : "기출은 분석에만 쓰고 강의자료로 저장하지 않아요."}</span>
      </div>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {pa && (
        <>
          {pa.summary && <div className="summary-tip"><Md>{pa.summary}</Md></div>}
          <p className="lr-label">주제별 출제 (문항 수)</p>
          <div className="ex-topics">
            {pa.topics.map(t => (
              <div key={t.name} className="ex-topic">
                <span className="ex-topic-name" title={t.match ? `강의 개념: ${t.match}` : "강의 개념과 연결 안 됨"}>{t.name}</span>
                <span className="ex-topic-bar"><span style={{ width: `${t.count / max * 100}%` }} /></span>
                <span className="ex-topic-n">{t.count}</span>
                {t.match ? <span className="lr-chip">{t.match}</span> : <span className="lr-muted">—</span>}
              </div>
            ))}
          </div>
          {Object.keys(pa.types || {}).length > 0 && (
            <div className="ex-types">{Object.entries(pa.types).map(([k, v]) => <span key={k} className="lr-chip">{k} {v}</span>)}</div>
          )}
          {pa.difficulty && <p><strong>난이도</strong> {pa.difficulty}</p>}
          {pa.tips?.length > 0 && <ul className="ex-tips">{pa.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          <p className="lr-muted">이 분석은 ‘한 장 요약’과 ‘예상 문제’를 다시 만들 때 반영돼요.</p>
        </>
      )}
    </div>
  );
}

function PrepDetail({ prepId, onBack, onDeleted, onOpenDoc, onOpenSource, onSaveNote }) {
  const [prep, setPrep] = useState(null);
  const [tab, setTab] = useState("sheet");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => { apiFetch(`/exam/${prepId}`).then(setPrep).catch(e => setError(e.message)); }, [prepId]);

  async function gen(kind) {
    setBusy(kind); setError("");
    try {
      if (kind === "sheet") {
        const r = await apiFetch(`/exam/${prepId}/sheet`, { method: "POST" }, 240_000);
        setPrep(p => ({ ...p, sheet: r.sheet }));
      } else {
        const r = await apiFetch(`/exam/${prepId}/predict`, json({ n: 8 }), 240_000);
        setPrep(p => ({ ...p, predicted: r }));
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  if (error && !prep) return <div className="error-banner"><span>{error}</span></div>;
  if (!prep) return <div className="loading-wrap"><div className="spinner" /></div>;
  const dd = ddayOf(prep.exam_date);
  const single = prep.docs.length === 1 ? prep.docs[0].doc_id : null;

  return (
    <div className="ex-detail">
      <button className="btn-ghost btn-sm" onClick={onBack}>← 시험 대비 목록</button>
      <div className="ex-detail-head">
        <h1 className="page-title">{prep.title}</h1>
        {dd && <span className="ex-dday">{dd}</span>}
      </div>
      <div className="ex-docchips">
        {prep.docs.map(d => (
          <button key={d.doc_id} className="doc-note-chip" onClick={() => onOpenDoc(d.doc_id, d.filename, "summary")}>
            <DocIcon size="0.9em" /> {(d.filename || "삭제된 자료").replace(/\.pdf$/i, "")}
          </button>
        ))}
      </div>

      <div className="tabs" role="tablist">
        {[["sheet", "한 장 요약"], ["predict", "예상 문제"], ["mistakes", "자주 틀린 것"], ["past", "기출 분석"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {error && <div className="error-banner"><span className="error-icon"><WarningIcon size="15px" /></span><span>{error}</span></div>}

      {tab === "sheet" && (
        <div className="ex-pane">
          {prep.sheet ? (
            <>
              <div className="ex-sheet"><Md>{prep.sheet}</Md></div>
              <div className="ex-pane-foot">
                <button className="btn-secondary btn-sm" onClick={() => onSaveNote(`${prep.title} 한 장 요약`, prep.sheet)}>노트로 저장</button>
                <button className="btn-secondary btn-sm" onClick={() => window.print()}>인쇄</button>
                <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => gen("sheet")}>{busy === "sheet" ? "다시 만드는 중…" : "다시 만들기"}</button>
              </div>
            </>
          ) : (
            <div className="lr-empty-box">
              <p><strong>시험 직전에 볼 A4 한 장 요약</strong></p>
              <p className="lr-muted">자료 요약 + 내 약한 개념·틀린 문제 + 기출 경향을 모아 꼭 외울 것만 정리해요.</p>
              <button className="btn-primary" disabled={!!busy} onClick={() => gen("sheet")}><SparkleIcon size="1em" /> {busy ? "만드는 중… (최대 1~2분)" : "한 장 요약 만들기"}</button>
            </div>
          )}
        </div>
      )}
      {tab === "predict" && (
        <div className="ex-pane">
          {prep.predicted?.questions?.length ? (
            <>
              <Predicted data={prep.predicted} singleDocId={single} onOpenSource={onOpenSource} />
              <div className="ex-pane-foot">
                <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => gen("predict")}>{busy === "predict" ? "다시 만드는 중…" : "새 예상 문제 만들기"}</button>
              </div>
            </>
          ) : (
            <div className="lr-empty-box">
              <p><strong>실제 시험에 나올 법한 예상 문제</strong></p>
              <p className="lr-muted">기출 경향과 내 약점을 반영해 출제 이유와 함께 보여줘요. 기출을 먼저 올리면 더 정확해요.</p>
              <button className="btn-primary" disabled={!!busy} onClick={() => gen("predict")}><SparkleIcon size="1em" /> {busy ? "만드는 중… (최대 1~2분)" : "예상 문제 만들기"}</button>
            </div>
          )}
        </div>
      )}
      {tab === "mistakes" && <div className="ex-pane"><Mistakes prepId={prep.id} onOpenDoc={onOpenDoc} /></div>}
      {tab === "past" && <div className="ex-pane"><PastAnalysis prep={prep} onUpdated={setPrep} /></div>}

      <div className="ex-danger">
        {confirmDel ? (
          <>
            <span>이 시험 대비를 지울까요? (자료·오답은 그대로예요)</span>
            <button className="btn-danger btn-sm" onClick={async () => { await apiFetch(`/exam/${prep.id}`, { method: "DELETE" }); onDeleted(); }}>삭제</button>
            <button className="btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>취소</button>
          </>
        ) : <button className="btn-ghost btn-sm" onClick={() => setConfirmDel(true)}><TrashIcon size="1em" /> 시험 대비 삭제</button>}
      </div>
    </div>
  );
}

/** 사이드바 '시험 대비' */
export default function ExamPage({ prepId, docs, onOpenPrep, onOpenDoc, onOpenSource, onSaveNote }) {
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!prepId) apiFetch("/exam").then(setList).catch(e => setError(e.message));
  }, [prepId]);

  if (prepId) {
    return <PrepDetail prepId={prepId} onBack={() => onOpenPrep(null)} onDeleted={() => onOpenPrep(null)}
      onOpenDoc={onOpenDoc} onOpenSource={onOpenSource} onSaveNote={onSaveNote} />;
  }
  return (
    <div className="ex-page">
      <div className="ex-detail-head">
        <h1 className="page-title">시험 대비</h1>
        {!creating && <button className="btn-primary btn-sm" onClick={() => setCreating(true)}>+ 새 시험 대비</button>}
      </div>
      <p className="lr-muted fc-page-intro">시험 범위 자료를 고르면 한 장 요약·예상 문제·자주 틀린 것·기출 분석을 한곳에서 준비할 수 있어요.</p>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {creating && <NewPrep docs={docs} onCancel={() => setCreating(false)} onCreated={(p) => { setCreating(false); onOpenPrep(p.id); }} />}
      {!list ? <div className="loading-wrap"><div className="spinner" /></div> : list.length === 0 && !creating ? (
        <div className="lr-empty-box">
          <p><TargetIcon size="1.4em" /></p>
          <p><strong>다가오는 시험이 있나요?</strong></p>
          <button className="btn-primary" onClick={() => setCreating(true)}>시험 대비 시작하기</button>
        </div>
      ) : (
        <div className="ex-cards">
          {list.map(p => (
            <button key={p.id} className="ex-card" onClick={() => onOpenPrep(p.id)}>
              <span className="ex-card-top"><strong>{p.title}</strong>{p.exam_date && <span className="ex-dday">{ddayOf(p.exam_date)}</span>}</span>
              <span className="lr-muted">자료 {p.doc_count}개{p.exam_date ? ` · ${p.exam_date}` : ""}</span>
              <span className="ex-card-steps">
                <span className={p.has_sheet ? "on" : ""}>한 장 요약</span>
                <span className={p.has_predicted ? "on" : ""}>예상 문제</span>
                <span className={p.has_past ? "on" : ""}>기출 분석</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
