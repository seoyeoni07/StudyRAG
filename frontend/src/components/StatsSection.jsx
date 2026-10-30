import { useState, useEffect } from "react";
import { apiFetch } from "../api";

// SVG 꺾은선 차트 (점수 추이)
function LineChart({ data }) {
  if (!data.length) return <p className="stats-empty">퀴즈를 풀면 점수 추이가 표시돼요</p>;
  const W = 560, H = 140, PAD = { top: 12, right: 12, bottom: 28, left: 28 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const xs = data.map((_, i) => PAD.left + (i / Math.max(data.length - 1, 1)) * iW);
  const ys = data.map(d => PAD.top + iH - (d.score_pct / 100) * iH);
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const area = [`M${xs[0]},${ys[0]}`, ...xs.slice(1).map((x, i) => `L${x},${ys[i + 1]}`),
    `L${xs[xs.length - 1]},${PAD.top + iH}`, `L${xs[0]},${PAD.top + iH}`, "Z"].join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="stats-chart" role="img" aria-label="점수 추이 차트">
      {[0, 25, 50, 75, 100].map(v => {
        const y = PAD.top + iH - (v / 100) * iH;
        return (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={PAD.left + iW} y2={y} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={y + 4} fontSize="9" fill="var(--text-3)" textAnchor="end">{v}</text>
          </g>
        );
      })}
      <path d={area} fill="var(--primary)" opacity="0.08" />
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="3.5" fill="var(--primary)" stroke="white" strokeWidth="1.5">
          <title>{data[i].doc_name} — {data[i].score_pct}% ({data[i].correct}/{data[i].total})</title>
        </circle>
      ))}
      {data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 4) === 0).map((d) => {
        const origIdx = data.indexOf(d);
        return (
          <text key={origIdx} x={xs[origIdx]} y={H - 4} fontSize="9" fill="var(--text-3)" textAnchor="middle">
            {new Date(d.date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
          </text>
        );
      })}
    </svg>
  );
}

// 숙련도+기억유지율 바 (자료별)
function MasteryBar({ doc }) {
  const m = doc.mastery_pct ?? doc.avg_pct;
  const r = doc.retention_pct ?? 100;
  const mColor = m >= 80 ? "var(--green)" : m >= 60 ? "var(--primary)" : m >= 40 ? "var(--amber)" : "var(--red)";
  const rColor = r >= 70 ? "var(--primary)" : r >= 40 ? "var(--amber)" : "var(--red)";
  const needsWork = m < 60;
  return (
    <div className="mastery-row" role="listitem">
      <div className="mastery-row-head">
        <span className="mastery-doc-name" title={doc.name}>{doc.name}</span>
        {needsWork && <span className="mastery-badge mastery-badge--warn" aria-label="집중 학습 필요">집중 필요</span>}
      </div>
      <div className="mastery-bars">
        <div className="mastery-bar-wrap" title={`숙련도 ${m}%`}>
          <span className="mastery-bar-label">숙련도</span>
          <div className="mastery-bar-track" role="progressbar" aria-valuenow={m} aria-valuemin={0} aria-valuemax={100} aria-label={`숙련도 ${m}%`}>
            <div className="mastery-bar-fill" style={{ width: `${m}%`, background: mColor }} />
          </div>
          <span className="mastery-bar-pct">{m}%</span>
        </div>
        <div className="mastery-bar-wrap" title={`기억 유지율 ${r}%`}>
          <span className="mastery-bar-label">기억</span>
          <div className="mastery-bar-track" role="progressbar" aria-valuenow={r} aria-valuemin={0} aria-valuemax={100} aria-label={`기억 유지율 ${r}%`}>
            <div className="mastery-bar-fill" style={{ width: `${r}%`, background: rColor }} />
          </div>
          <span className="mastery-bar-pct">{r}%</span>
        </div>
      </div>
    </div>
  );
}

export default function StatsSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiFetch("/quiz/user-stats")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-wrap" role="status" aria-label="통계 불러오는 중"><div className="spinner" /></div>;
  if (!data) return <p className="stats-empty">통계를 불러올 수 없어요</p>;

  const diffColors = { 기본: "var(--primary)", 응용: "var(--amber)", 심화: "var(--red)" };
  const diffItems = Object.entries(data.difficulty_stats)
    .filter(([, s]) => s.total > 0)
    .map(([d, s]) => ({
      label: d,
      value: Math.round(s.wrong / s.total * 100),
      color: diffColors[d],
      suffix: `오답률 ${Math.round(s.wrong / s.total * 100)}% (${s.wrong}/${s.total})`,
    }));

  const docsSorted = [...(data.doc_stats || [])].sort((a, b) => (a.mastery_pct ?? a.avg_pct) - (b.mastery_pct ?? b.avg_pct));
  const needsWorkDocs = docsSorted.filter(d => (d.mastery_pct ?? d.avg_pct) < 60);

  return (
    <div className="stats-wrap">
      {/* 요약 카드 */}
      <div className="stats-summary" role="list" aria-label="학습 통계 요약">
        <div className="stats-card" role="listitem">
          <span className="stats-card-value">{data.total_sessions}</span>
          <span className="stats-card-label">총 퀴즈 횟수</span>
        </div>
        <div className="stats-card stats-card--accent" role="listitem">
          <span className="stats-card-value">{data.avg_mastery_pct ?? data.avg_score_pct}%</span>
          <span className="stats-card-label">평균 숙련도</span>
        </div>
        <div className="stats-card" role="listitem"
          style={{ background: (data.avg_retention_pct ?? 100) < 50 ? "var(--amber-bg)" : undefined }}>
          <span className="stats-card-value">{data.avg_retention_pct ?? 100}%</span>
          <span className="stats-card-label">평균 기억 유지율</span>
        </div>
        <div className="stats-card stats-card--red" role="listitem">
          <span className="stats-card-value">{data.total_wrongs}</span>
          <span className="stats-card-label">누적 오답 수</span>
        </div>
      </div>

      {/* 집중 필요 자료 알림 */}
      {needsWorkDocs.length > 0 && (
        <section className="stats-section stats-alert" aria-label="집중 학습 필요 자료">
          <h2 className="stats-section-title">⚠️ 집중 학습 필요</h2>
          <p className="stats-sub">숙련도 60% 미만 자료예요. 복습이 필요해요.</p>
          <ul className="stats-alert-list">
            {needsWorkDocs.map((d, i) => (
              <li key={i} className="stats-alert-item">
                <span className="stats-alert-name">{d.name}</span>
                <span className="stats-alert-pct" style={{ color: "var(--red)" }}>숙련도 {d.mastery_pct ?? d.avg_pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 자료별 숙련도 + 기억 유지율 */}
      {docsSorted.length > 0 && (
        <section className="stats-section" aria-label="자료별 숙련도">
          <h2 className="stats-section-title">자료별 숙련도 & 기억 유지율</h2>
          <p className="stats-sub">숙련도 = 최근 퀴즈 가중 정답률 · 기억 유지율 = 에빙하우스 망각곡선 추정</p>
          <div role="list" aria-label="자료 목록">
            {docsSorted.map((d, i) => <MasteryBar key={i} doc={d} />)}
          </div>
        </section>
      )}

      {/* 점수 추이 */}
      <section className="stats-section" aria-label="점수 추이">
        <h2 className="stats-section-title">점수 추이 (최근 {data.recent_sessions.length}회)</h2>
        <div className="stats-chart-wrap">
          <LineChart data={data.recent_sessions} />
        </div>
      </section>

      {/* 난이도별 오답률 */}
      {diffItems.length > 0 && (
        <section className="stats-section" aria-label="난이도별 오답률">
          <h2 className="stats-section-title">난이도별 오답률</h2>
          <div className="stats-hbar-list" role="list">
            {diffItems.map((it, i) => (
              <div key={i} className="stats-hbar-row" role="listitem">
                <span className="stats-hbar-label">{it.label}</span>
                <div className="stats-hbar-track" role="progressbar" aria-valuenow={it.value} aria-valuemin={0} aria-valuemax={100} aria-label={`${it.label} 오답률 ${it.value}%`}>
                  <div className="stats-hbar-fill" style={{ width: `${it.value}%`, background: it.color }} />
                </div>
                <span className="stats-hbar-value">{it.suffix}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 취약 개념 TOP 10 */}
      {data.weak_concepts.length > 0 && (
        <section className="stats-section" aria-label="취약 개념">
          <h2 className="stats-section-title">취약 개념 TOP {data.weak_concepts.length}</h2>
          <p className="stats-sub">자주 틀린 문제예요. 적응형 퀴즈를 켜면 이 개념들이 자동으로 더 출제돼요.</p>
          <div className="stats-weak-list" role="list">
            {(expanded ? data.weak_concepts : data.weak_concepts.slice(0, 5)).map((c, i) => (
              <div key={i} className="stats-weak-row" role="listitem">
                <span className="stats-weak-rank" aria-hidden="true">{i + 1}</span>
                <span className="stats-weak-q">{c.question}</span>
                <span className="stats-weak-count">{c.count}회 오답</span>
              </div>
            ))}
          </div>
          {data.weak_concepts.length > 5 && (
            <button className="btn-ghost stats-more-btn" onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}>
              {expanded ? "접기" : `더 보기 (${data.weak_concepts.length - 5}개 더)`}
            </button>
          )}
        </section>
      )}

      {data.total_sessions === 0 && (
        <div className="stats-zero" role="status">
          <p>아직 퀴즈 기록이 없어요.</p>
          <p>자료를 선택하고 퀴즈 탭에서 문제를 풀어보세요!</p>
        </div>
      )}
    </div>
  );
}
