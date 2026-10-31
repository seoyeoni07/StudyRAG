import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { LEVELS } from "./MasteryMap";
import "./learn.css";

/** 학습 통계: 전체 자료에서 약한 개념 TOP — 누르면 그 자료의 '이해도' 탭으로 */
export default function WeakConcepts({ onOpenDoc, limit = 8 }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { apiFetch(`/learn/weak?limit=${limit}`).then(setRows).catch(() => setRows([])); }, [limit]);
  if (!rows) return null;
  return (
    <div className="dash-panel lr-weakpanel">
      <div className="dash-panel-head"><span className="dash-panel-title">약한 개념</span></div>
      {rows.length === 0 ? (
        <p className="dash-planner-empty">퀴즈·플래시카드를 풀면 헷갈리는 개념을 여기 모아줘요.</p>
      ) : (
        <div className="dash-doc-table">
          {rows.map(r => (
            <button key={r.doc_id + r.concept} className="dash-doc-row lr-weakrow"
              onClick={() => onOpenDoc?.(r.doc_id, r.filename, r.group_id)}>
              <span className={`lr-dot lr-lv-${r.level}`} />
              <span className="lr-weakrow-name">{r.concept}</span>
              <span className="lr-muted lr-weakrow-doc">{(r.filename || "").replace(/\.pdf$/i, "")}</span>
              <span className={`lr-chip lr-chip--${r.level}`}>{LEVELS[r.level].label} {Math.round(r.score * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
