export default function TechIntroPage() {
  return (
    <div className="tech-page">
      <div className="tech-hero">
        <p className="tech-eyebrow">StudyRAG가 사용하는 기술</p>
        <h1 className="tech-headline">AI 학습 루프의 원리</h1>
        <p className="tech-sub">단순 요약이 아닙니다. RAG · LLM · 간격반복이 하나의 루프를 만듭니다.</p>
      </div>

      <div className="tech-section">
        <div className="tech-step-badge">01</div>
        <div className="tech-step-content">
          <h2 className="tech-step-title">문서 파싱 · OCR</h2>
          <p className="tech-step-desc">
            업로드한 PDF·이미지를 텍스트로 변환합니다. 이미지 슬라이드는 <strong>Gemini Vision / OpenRouter 멀티모달</strong> 모델이 OCR로 읽고,
            PDF는 직접 텍스트를 추출합니다.
          </p>
          <div className="tech-chips">
            <span className="tech-chip">Google Gemini Vision</span>
            <span className="tech-chip">OpenRouter</span>
            <span className="tech-chip">PyMuPDF</span>
          </div>
        </div>
      </div>

      <div className="tech-section">
        <div className="tech-step-badge">02</div>
        <div className="tech-step-content">
          <h2 className="tech-step-title">RAG — 검색 증강 생성</h2>
          <p className="tech-step-desc">
            문서를 청크로 나눠 <strong>ChromaDB</strong> 벡터스토어에 임베딩합니다. Q&A·AI 튜터 질문이 들어오면
            관련 청크를 빠르게 검색해 LLM에게 전달합니다. 환각 없이 자료에만 기반한 답변이 가능한 이유입니다.
          </p>
          <div className="tech-chips">
            <span className="tech-chip">ChromaDB</span>
            <span className="tech-chip">LangChain</span>
            <span className="tech-chip">텍스트 임베딩</span>
            <span className="tech-chip">코사인 유사도 검색</span>
          </div>
        </div>
      </div>

      <div className="tech-section">
        <div className="tech-step-badge">03</div>
        <div className="tech-step-content">
          <h2 className="tech-step-title">AI 요약 · 퀴즈 생성</h2>
          <p className="tech-step-desc">
            전체 청크를 바탕으로 <strong>OpenRouter LLM</strong>이 개요·핵심 개념·학습 팁·키워드를 JSON으로 구조화합니다.
            퀴즈는 오지선다·OX·서술형을 난이도별로 자동 생성하며, 자주 틀린 개념을 분석해 취약 유형을 더 많이 출제합니다.
          </p>
          <div className="tech-chips">
            <span className="tech-chip">OpenRouter LLM</span>
            <span className="tech-chip">구조화 JSON 프롬프트</span>
            <span className="tech-chip">적응형 난이도</span>
          </div>
        </div>
      </div>

      <div className="tech-section">
        <div className="tech-step-badge">04</div>
        <div className="tech-step-content">
          <h2 className="tech-step-title">SM-2 간격반복 · 에빙하우스 망각곡선</h2>
          <p className="tech-step-desc">
            틀린 문제는 <strong>SM-2 알고리즘</strong>으로 다음 복습 날짜가 자동 계산됩니다.
            학습 통계 화면에서는 에빙하우스 망각곡선(R = e<sup>−t/S</sup>)으로 현재 기억 유지율을 시각화해
            언제 복습해야 할지 알려줍니다.
          </p>
          <div className="tech-chips">
            <span className="tech-chip">SM-2 알고리즘</span>
            <span className="tech-chip">에빙하우스 망각곡선</span>
            <span className="tech-chip">가중 숙련도 계산</span>
          </div>
        </div>
      </div>

      <div className="tech-section">
        <div className="tech-step-badge">05</div>
        <div className="tech-step-content">
          <h2 className="tech-step-title">소크라테스식 AI 튜터</h2>
          <p className="tech-step-desc">
            AI 튜터는 답을 직접 주지 않습니다. RAG로 검색한 관련 내용을 기반으로 학생이
            스스로 추론하도록 유도하는 소크라테스식 대화를 구현합니다. 이해 없는 암기를 방지합니다.
          </p>
          <div className="tech-chips">
            <span className="tech-chip">소크라테스식 프롬프트</span>
            <span className="tech-chip">RAG 컨텍스트 주입</span>
            <span className="tech-chip">LangChain ConversationChain</span>
          </div>
        </div>
      </div>

      <div className="tech-stack-card">
        <h3 className="tech-stack-title">기술 스택 요약</h3>
        <div className="tech-stack-grid">
          <div className="tech-stack-col">
            <span className="tech-stack-label">프론트엔드</span>
            <span>React + Vite · PWA (Workbox)</span>
          </div>
          <div className="tech-stack-col">
            <span className="tech-stack-label">백엔드</span>
            <span>FastAPI · Python</span>
          </div>
          <div className="tech-stack-col">
            <span className="tech-stack-label">AI</span>
            <span>LangChain · OpenRouter · Google Gemini</span>
          </div>
          <div className="tech-stack-col">
            <span className="tech-stack-label">벡터 DB</span>
            <span>ChromaDB (임베딩 검색)</span>
          </div>
          <div className="tech-stack-col">
            <span className="tech-stack-label">데이터베이스</span>
            <span>PostgreSQL (Supabase)</span>
          </div>
          <div className="tech-stack-col">
            <span className="tech-stack-label">인증</span>
            <span>Firebase Auth (Google 로그인)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
