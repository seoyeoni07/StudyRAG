import { useEffect, useState } from "react";

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
  const [legal, setLegal] = useState(null); // null | "terms" | "privacy"

  useEffect(() => { window.scrollTo(0, 0); }, []);

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

      {/* ── 히어로 (텍스트 + 제품 목업 나란히) ── */}
      <section className="lp-hero">
        <div className="lp-hero-text">
          <p className="lp-eyebrow">강의자료 AI 학습 도구</p>
          <h1 className="lp-headline">
            이해만으로는<br />부족합니다.<br /><span>기억까지.</span>
          </h1>
          <p className="lp-sub">
            자료를 올리면 AI가 요약하고, 질문에 답하고, 퀴즈를 내고, 오답을 추적합니다.
            자료에서 시험까지, 끊기지 않는 학습 루프.
          </p>
          <button className="btn-primary lp-cta-btn" onClick={onStart}>무료로 시작하기</button>
        </div>

        <div className="lp-hero-preview">
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
        </div>
      </section>

      {/* ── 학습 루프 5단계 ── */}
      <section className="lp-steps-section">
        <h2 className="lp-section-title">자료 하나로 시험까지</h2>
        <div className="lp-steps">
          {[
            { n: "01", title: "자료 업로드",     desc: "PDF·이미지 강의자료를 올리면 AI가 전체를 읽고 분석합니다." },
            { n: "02", title: "요약 · Q&A",      desc: "자동 생성 요약 확인, 모르는 부분은 바로 질문합니다." },
            { n: "03", title: "AI 튜터 대화",    desc: "답을 주지 않고 스스로 이해하게 유도하는 소크라테스식 학습." },
            { n: "04", title: "퀴즈 · 오답 복습", desc: "자동 생성 퀴즈, 오답 추적, SM-2 간격반복으로 완전히 기억합니다." },
            { n: "05", title: "그룹 스터디",     desc: "팀과 같은 자료로 실시간 그룹 퀴즈를 풀고 순위를 확인합니다." },
          ].map(s => (
            <div key={s.n} className="lp-step">
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
      <section className="lp-diff-section">
        <div className="lp-diff-inner">
          <p className="lp-diff-label">다른 도구와 다른 점</p>
          <p className="lp-diff-text">
            NotebookLM은 자료를 정리해줍니다. StudyRAG는 자료로 시험을 통과하게 합니다.
            이해에서 끝나지 않고, 기억으로 이어지는 유일한 학습 루프입니다.
          </p>
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

      {/* ── 약관 모달 ── */}
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
