import { useEffect } from "react";

export default function LandingPage({ onStart }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="lp-root">

      {/* ── 상단 내비 ── */}
      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <div className="login-mark">SR</div>
          <span className="lp-brand-name">StudyRAG</span>
        </div>
        <button className="btn-secondary lp-nav-btn" onClick={onStart}>로그인 / 시작하기</button>
      </nav>

      {/* ── 히어로 ── */}
      <section className="lp-hero">
        <p className="lp-eyebrow">AI 기반 강의자료 학습 도구</p>
        <h1 className="lp-headline">
          이해만으로는<br />부족합니다.<br /><span>기억까지.</span>
        </h1>
        <p className="lp-sub">
          강의자료를 올리면 AI가 요약하고, 질문에 답하고, 퀴즈를 내고, 오답을 추적합니다.
          자료에서 시험까지, 끊기지 않는 학습 루프.
        </p>
        <button className="btn-primary lp-cta-btn" onClick={onStart}>무료로 시작하기</button>
      </section>

      {/* ── 앱 목업 ── */}
      <section className="lp-mockup-section">
        <div className="lp-mockup">
          <div className="lp-mock-topbar">
            <span className="lp-mock-doc-name">경영학원론 6장.pdf</span>
            <span className="lp-mock-status">AI 요약 완료</span>
          </div>
          <div className="lp-mock-tabs">
            {["요약", "Q&A", "AI 튜터", "퀴즈", "오답노트"].map(t => (
              <span key={t} className={`lp-mock-tab${t === "퀴즈" ? " lp-mock-tab--active" : ""}`}>{t}</span>
            ))}
          </div>
          <div className="lp-mock-body">
            <div className="lp-mock-meta">문제 3 / 10</div>
            <div className="lp-mock-question">마케팅 믹스의 4P 중 '가격'에 해당하는 전략 요소는?</div>
            <div className="lp-mock-options">
              <div className="lp-mock-opt">① Product</div>
              <div className="lp-mock-opt lp-mock-opt--correct">② Price</div>
              <div className="lp-mock-opt">③ Place</div>
              <div className="lp-mock-opt">④ Promotion</div>
            </div>
            <div className="lp-mock-result">
              <span className="lp-mock-correct-badge">정답</span>
              오답노트 2개 남음 · 다음 복습 내일
            </div>
          </div>
        </div>
      </section>

      {/* ── 학습 루프 ── */}
      <section className="lp-loop">
        <h2 className="lp-section-title">자료 하나로 시험까지</h2>
        <div className="lp-steps">
          {[
            { n: "01", title: "자료 업로드",  desc: "PDF·이미지 강의자료를 올립니다. AI가 전체를 읽고 분석합니다." },
            { n: "02", title: "요약 · Q&A",   desc: "자동 생성된 요약을 확인하고, 모르는 부분을 바로 질문합니다." },
            { n: "03", title: "AI 튜터 대화", desc: "답을 주지 않고 이해를 확인하는 소크라테스식 1:1 학습." },
            { n: "04", title: "퀴즈 · 오답 복습", desc: "자동 생성 퀴즈, 틀린 문제 추적, SM-2 간격반복으로 완전히 기억합니다." },
            { n: "05", title: "그룹 스터디",  desc: "팀과 같은 자료로 실시간 그룹 퀴즈를 풀고 순위를 봅니다." },
          ].map((s, i) => (
            <div key={i} className="lp-step">
              <span className="lp-step-n">{s.n}</span>
              <div>
                <div className="lp-step-title">{s.title}</div>
                <div className="lp-step-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 차별점 ── */}
      <section className="lp-diff">
        <div className="lp-diff-inner">
          <p className="lp-diff-label">다른 도구와 다른 점</p>
          <p className="lp-diff-text">
            NotebookLM은 자료를 정리해줍니다. StudyRAG는 자료로 시험을 통과하게 합니다.
            <br />이해에서 끝나지 않고, 기억으로 이어지는 유일한 학습 루프입니다.
          </p>
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className="lp-bottom-cta">
        <h2 className="lp-bottom-headline">아직 강의자료를 혼자 읽고 있나요?</h2>
        <p className="lp-bottom-sub">무료로 시작해서 다음 시험에 써보세요.</p>
        <button className="btn-primary lp-cta-btn" onClick={onStart}>무료로 시작하기</button>
      </section>

      <footer className="lp-footer">
        <span>© 2025 StudyRAG</span>
      </footer>

    </div>
  );
}
