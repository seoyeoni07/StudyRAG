import json

from .rag import get_vectorstore, _llm

_PROMPT = """\
다음은 강의자료에서 추출한 내용입니다. 대학생을 위한 학습 요약을 작성하세요.

강의자료:
{context}

반드시 다음 JSON 형식으로만 응답하세요:
{{
  "overview": "이 강의의 핵심을 3~5문장으로 설명",
  "key_concepts": ["핵심 개념 1", "핵심 개념 2", "핵심 개념 3", "핵심 개념 4", "핵심 개념 5"],
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6", "키워드7", "키워드8"],
  "study_tip": "이 강의를 효과적으로 학습하기 위한 한 가지 팁"
}}"""


def summarize_document(doc_id: str) -> dict:
    vs = get_vectorstore(doc_id)
    retriever = vs.as_retriever(search_type="mmr", search_kwargs={"k": 12, "fetch_k": 40})
    docs = retriever.invoke("강의 핵심 개념 학습 목표 주요 내용 전체 개요")
    if not docs:
        return {"overview": "요약을 생성할 수 없습니다.", "key_concepts": [], "keywords": [], "study_tip": ""}
    context = "\n\n---\n\n".join(d.page_content for d in docs[:10])
    try:
        response = _llm().invoke(_PROMPT.format(context=context))
        return json.loads(response.content)
    except Exception:
        return {"overview": "요약 생성 중 오류가 발생했습니다.", "key_concepts": [], "keywords": [], "study_tip": ""}
