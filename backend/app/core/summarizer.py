import json

from .rag import get_vectorstore, _llm

_PROMPT = """\
다음은 강의자료에서 추출한 내용입니다. 대학생을 위한 학습 요약을 작성하세요.

강의자료:
{context}

반드시 다음 JSON 형식으로만 응답하세요:
{{
  "overview": "이 강의의 핵심을 3~5문장으로 설명",
  "tags": ["태그1", "태그2", "태그3"],
  "key_concepts": ["핵심 개념 1", "핵심 개념 2", "핵심 개념 3", "핵심 개념 4", "핵심 개념 5"],
  "concepts": ["개념명1", "개념명2", "개념명3", "개념명4", "개념명5", "개념명6"],
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6", "키워드7", "키워드8"],
  "study_tip": "이 강의를 효과적으로 학습하기 위한 한 가지 팁"
}}

concepts 규칙: 이 강의에서 학생이 알아야 할 개념의 '이름'만 5~8개 (2~15글자, 예: "스택", "열역학 제1법칙"). 문장 금지.
tags 규칙: 자료 내용을 가장 잘 나타내는 명사 2~3개. 각 태그는 반드시 1~4글자 단어 하나만 (예: "열역학", "미적분", "세포"). 절대 긴 구절 금지."""


def summarize_document(doc_id: str) -> dict:
    vs = get_vectorstore(doc_id)
    retriever = vs.as_retriever(search_type="mmr", search_kwargs={"k": 12, "fetch_k": 40})
    docs = retriever.invoke("강의 핵심 개념 학습 목표 주요 내용 전체 개요")
    if not docs:
        return {"overview": "요약을 생성할 수 없습니다.", "key_concepts": [], "keywords": [], "study_tip": ""}
    context = "\n\n---\n\n".join(d.page_content for d in docs[:10])
    try:
        from .learning import parse_json
        response = _llm().invoke(_PROMPT.format(context=context))
        result = parse_json(response.content)
        result["concept_pages"] = concept_pages(doc_id, result.get("key_concepts") or [])
        return result
    except Exception:
        return {"overview": "요약 생성 중 오류가 발생했습니다.", "key_concepts": [], "keywords": [], "study_tip": ""}


def concept_pages(doc_id: str, items: list[str]) -> list[int | None]:
    """요약의 핵심 개념마다 가장 가까운 자료 조각의 페이지 (근거 보기용). 임베딩은 로컬이라 AI 비용 없음."""
    vs = get_vectorstore(doc_id)
    pages = []
    for c in items[:10]:
        try:
            hits = vs.similarity_search(str(c)[:300], k=1)
            pages.append(hits[0].metadata.get("page") if hits else None)
        except Exception:
            pages.append(None)
    return pages
