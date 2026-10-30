import { useEffect, useState, useRef } from "react";

const MOCK_QUESTIONS = [
  {
    meta: "문제 3 / 10",
    q: "마케팅 믹스의 4P 중 '가격'에 해당하는 전략 요소는?",
    opts: ["① Product", "② Price", "③ Place", "④ Promotion"],
    correct: 1,
    result: "오답노트 2개 남음 · 다음 복습 내일",
  },
  {
    meta: "문제 7 / 10",
    q: "SWOT 분석에서 'O'가 의미하는 것은?",
    opts: ["① Objective", "② Opportunity", "③ Obstacle", "④ Output"],
    correct: 1,
    result: "연속 정답 · 다음 복습 3일 후",
  },
];

function LegalModal({ title, children, onClose }) {
  return (
    <div className="lp-legal-overlay" onClick={onClose}>
      <div className="lp-legal-modal" onClick={e => e.stopPropagation()}>
        <div className="lp-legal-header">
          <span>{title}</span>
          <button onClick={onClose}>닫기</button>
        </div>
        <div className="lp-legal-body">{children}</div>
      </div>
    </div>
  );
}

export default function LandingPage({ onStart }) {
  const [legal, setLegal] = useState(null);
  const [mockIdx, setMockIdx] = useState(0);
  // phase: "idle" | "answered" | "leaving"
  const [mockPhase, setMockPhase] = useState("idle");
  const phaseTimer = useRef(null);

  // 목업 사이클: idle 2s → answered 2.5s → leaving 0.4s → next idle
  useEffect(() => {
    const cycle = () => {
      phaseTimer.current = setTimeout(() => {
        setMockPhase("answered");
        phaseTimer.current = setTimeout(() => {
          setMockPhase("leaving");
          phaseTimer.current = setTimeout(() => {
            setMockIdx(i => (i + 1) % MOCK_QUESTIONS.length);
            setMockPhase("idle");
            cycle();
          }, 400);
        }, 2500);
      }, 2000);
    };
    cycle();
    return () => clearTimeout(phaseTimer.current);
  }, []);

  // 스크롤 reveal
  useEffect(() => {
    window.scrollTo(0, 0);
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("lp-revealed"); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".lp-step, .lp-section-title, .lp-bottom-cta, .lp-steps-section").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const q = MOCK_QUESTIONS[mockIdx];

  return (
    <div className="lp-root">

      {/* ── 내비 ── */}
      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <div className="login-mark">SR</div>
          <span className="lp-brand-name">StudyRAG</span>
        </div>
        <button className="btn-secondary lp-nav-btn" onClick={onStart}>로그인 / 시작하기</button>
      </nav>

      {/* ── 히어로 ── */}
      <section className="lp-hero">
        <div className="lp-hero-text">
          <p className="lp-eyebrow lp-animate-1">강의자료 AI 학습 도구</p>
          <h1 className="lp-headline lp-animate-2">
            이해만으로는<br />부족합니다.<br /><span>기억까지.</span>
          </h1>
          <p className="lp-sub lp-animate-3">
            자료를 올리면 AI가 요약하고, 질문에 답하고, 퀴즈를 내고, 오답을 추적합니다.
            자료에서 시험까지, 끊기지 않는 학습 루프.
          </p>
          <button className="btn-primary lp-cta-btn lp-animate-4" onClick={onStart}>무료로 시작하기</button>
        </div>

        <div className="lp-hero-preview lp-animate-5">
          <div className={`lp-mockup${mockPhase === "leaving" ? " lp-mockup--leaving" : ""}`}>
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
              <div className="lp-mock-meta">{q.meta}</div>
              <div className="lp-mock-question">{q.q}</div>
              <div className="lp-mock-options">
                {q.opts.map((opt, i) => (
                  <div key={i} className={[
                    "lp-mock-opt",
                    mockPhase !== "idle" && i === q.correct ? "lp-mock-opt--correct" : "",
                  ].filter(Boolean).join(" ")}
                    style={{ transitionDelay: mockPhase === "answered" ? `${i * 60}ms` : "0ms" }}>
                    {opt}
                  </div>
                ))}
              </div>
              <div className={`lp-mock-result${mockPhase === "answered" ? " lp-mock-result--visible" : ""}`}>
                <span className="lp-mock-correct-badge">정답</span>
                {q.result}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 학습 루프 5단계 ── */}
      <section className="lp-steps-section">
        <h2 className="lp-section-title">자료 하나로 시험까지</h2>
        <div className="lp-steps">
          {[
            { n: "01", title: "자료 업로드",      desc: "PDF·이미지 강의자료를 올리면 AI가 전체를 읽고 분석합니다." },
            { n: "02", title: "요약 · Q&A",       desc: "자동 생성 요약 확인, 모르는 부분은 바로 질문합니다." },
            { n: "03", title: "AI 튜터 대화",     desc: "답을 주지 않고 스스로 이해하게 유도하는 소크라테스식 학습." },
            { n: "04", title: "퀴즈 · 오답 복습", desc: "자동 생성 퀴즈, 오답 추적, SM-2 간격반복으로 완전히 기억합니다." },
            { n: "05", title: "그룹 스터디",      desc: "팀과 같은 자료로 실시간 그룹 퀴즈를 풀고 순위를 확인합니다." },
          ].map((s, i) => (
            <div key={s.n} className="lp-step" style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="lp-step-n">{s.n}</span>
              <div>
                <div className="lp-step-title">{s.title}</div>
                <div className="lp-step-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className="lp-bottom-cta">
        <h2 className="lp-bottom-headline">아직 강의자료를 혼자 읽고 있나요?</h2>
        <p className="lp-bottom-sub">무료로 시작해서 다음 시험에 써보세요.</p>
        <button className="lp-bottom-btn" onClick={onStart}>무료로 시작하기</button>
      </section>

      {/* ── 푸터 ── */}
      <footer className="lp-footer">
        <span>© 2025 StudyRAG</span>
        <div className="lp-footer-links">
          <button className="lp-footer-link" onClick={() => setLegal("terms")}>이용약관</button>
          <button className="lp-footer-link" onClick={() => setLegal("privacy")}>개인정보처리방침</button>
        </div>
      </footer>

      {legal === "terms" && (
        <LegalModal title="이용약관" onClose={() => setLegal(null)}>
          <p>본 약관은 StudyRAG 서비스 이용에 관한 기본 사항을 정합니다.</p>
          <p>서비스를 이용하시면 본 약관에 동의하신 것으로 간주합니다.</p>
          <p>서비스는 강의자료 기반 AI 학습 기능을 제공하며, 업로드된 자료는 학습 목적으로만 사용됩니다.</p>
          <p style={{color:"var(--text-4)", fontSize:12, marginTop:16}}>※ 실제 사업 정보·적용일·분쟁해결 절차 등은 정식 서비스 전 입력이 필요합니다.</p>
        </LegalModal>
      )}
      {legal === "privacy" && (
        <LegalModal title="개인정보처리방침" onClose={() => setLegal(null)}>
          <p><strong>수집 항목:</strong> 이메일, 표시 이름 (Google 로그인 시 Google 계정 정보)</p>
          <p><strong>수집 목적:</strong> 회원 식별, 자료·노트·학습 기록 관리</p>
          <p><strong>보관 기간:</strong> 회원 탈퇴 시까지</p>
          <p><strong>제3자 제공:</strong> 없음 (AI 처리에 OpenAI API 사용, 자료 내용 전달)</p>
          <p><strong>문의:</strong> 서비스 내 문의 기능 이용</p>
          <p style={{color:"var(--text-4)", fontSize:12, marginTop:16}}>※ 사업자 정보·법률 검토는 정식 서비스 전 확인이 필요합니다.</p>
        </LegalModal>
      )}
    </div>
  );
}
