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
    <svg viewBox={`0 0 ${W} ${H}`} className="stats-chart" aria-label="점수 추이 차트">
      {/* y축 가이드라인 */}
      {[0, 25, 50, 75, 100].map(v => {
        const y = PAD.top + iH - (v / 100) * iH;
        return (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={PAD.left + iW} y2={y} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={y + 4} fontSize="9" fill="var(--text-3)" textAnchor="end">{v}</text>
          </g>
        );
      })}
      {/* 영역 채우기 */}
      <path d={area} fill="var(--primary)" opacity="0.08" />
      {/* 선 */}
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* 점 */}
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="3.5" fill="var(--primary)" stroke="white" strokeWidth="1.5">
          <title>{data[i].doc_name} — {data[i].score_pct}% ({data[i].correct}/{data[i].total})</title>
        </circle>
      ))}
      {/* x축 날짜 (5개만) */}
      {data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 4) === 0).map((d, _, arr) => {
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

// SVG 수평 막대 차트 (자료별 성적 / 난이도별)
function HBarChart({ items, maxVal = 100 }) {
  if (!items.length) return <p className="stats-empty">데이터가 없어요</p>;
  return (
    <div className="stats-hbar-list">
      {items.map((it, i) => (
        <div key={i} className="stats-hbar-row">
          <span className="stats-hbar-label" title={it.label}>{it.label}</span>
          <div className="stats-hbar-track">
            <div className="stats-hbar-fill" style={{
              width: `${(it.value / maxVal) * 100}%`,
              background: it.color || "var(--primary)",
            }} />
          </div>
          <span className="stats-hbar-value">{it.suffix || `${it.value}%`}</span>
        </div>
      ))}
    </div>
  );
}

export default function StatsSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // 취약 개념 더보기

  useEffect(() => {
    apiFetch("/quiz/user-stats")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-wrap"><div className="spinner" /></div>;
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

  const docItems = data.doc_stats
    .sort((a, b) => a.avg_pct - b.avg_pct)
    .map(d => ({
      label: d.name,
      value: d.avg_pct,
      color: d.avg_pct >= 80 ? "var(--primary)" : d.avg_pct >= 50 ? "var(--amber)" : "var(--red)",
      suffix: `${d.avg_pct}% (${d.sessions}회)`,
    }));

  return (
    <div className="stats-wrap">
      {/* 요약 카드 */}
      <div className="stats-summary">
        <div className="stats-card">
          <span className="stats-card-value">{data.total_sessions}</span>
          <span className="stats-card-label">총 퀴즈 횟수</span>
        </div>
        <div className="stats-card stats-card--accent">
          <span className="stats-card-value">{data.avg_score_pct}%</span>
          <span className="stats-card-label">평균 정답률</span>
        </div>
        <div className="stats-card stats-card--red">
          <span className="stats-card-value">{data.total_wrongs}</span>
          <span className="stats-card-label">누적 오답 수</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-value">{data.total_docs}</span>
          <span className="stats-card-label">학습 자료 수</span>
        </div>
      </div>

      {/* 점수 추이 */}
      <section className="stats-section">
        <h2 className="stats-section-title">점수 추이 (최근 {data.recent_sessions.length}회)</h2>
        <div className="stats-chart-wrap">
          <LineChart data={data.recent_sessions} />
        </div>
      </section>

      {/* 자료별 성적 */}
      {docItems.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">자료별 평균 정답률</h2>
          <HBarChart items={docItems} />
        </section>
      )}

      {/* 난이도별 오답률 */}
      {diffItems.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">난이도별 오답률</h2>
          <HBarChart items={diffItems} />
        </section>
      )}

      {/* 취약 개념 TOP 10 */}
      {data.weak_concepts.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">취약 개념 TOP {data.weak_concepts.length}</h2>
          <p className="stats-sub">자주 틀린 문제예요. 다시 학습해보세요.</p>
          <div className="stats-weak-list">
            {(expanded ? data.weak_concepts : data.weak_concepts.slice(0, 5)).map((c, i) => (
              <div key={i} className="stats-weak-row">
                <span className="stats-weak-rank">{i + 1}</span>
                <span className="stats-weak-q">{c.question}</span>
                <span className="stats-weak-count">{c.count}회 오답</span>
              </div>
            ))}
          </div>
          {data.weak_concepts.length > 5 && (
            <button className="btn-ghost stats-more-btn" onClick={() => setExpanded(e => !e)}>
              {expanded ? "접기" : `더 보기 (${data.weak_concepts.length - 5}개 더)`}
            </button>
          )}
        </section>
      )}

      {data.total_sessions === 0 && (
        <div className="stats-zero">
          <p>아직 퀴즈 기록이 없어요.</p>
          <p>자료를 선택하고 퀴즈 탭에서 문제를 풀어보세요!</p>
        </div>
      )}
    </div>
  );
}
