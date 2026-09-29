import json
import random

from .rag import _llm, get_vectorstore

_GENERATE_PROMPT = """\
당신은 대학 강의자료 기반 퀴즈 출제 전문가입니다.
아래 강의자료를 바탕으로 {n}개의 퀴즈를 출제하세요.

출제 기준:
- 객관식(4지선다)과 단답형을 적절히 혼합하세요.
- 다음 세 난이도가 균형 있게 포함되도록 하세요:
  * 기본: 핵심 용어·정의 확인
  * 응용: 개념을 새로운 상황에 적용
  * 심화: 비교·분석·추론 필요
- 객관식 오답 선택지는 헷갈릴 수 있는 그럴듯한 내용으로 만드세요.
- 같은 개념이 반복되지 않도록 다양한 주제를 다루세요.

강의자료:
{context}

반드시 다음 JSON 형식으로만 응답하세요:
{{
  "questions": [
    {{
      "id": 1,
      "type": "multiple_choice",
      "difficulty": "기본",
      "question": "질문",
      "options": ["A. 선택지1", "B. 선택지2", "C. 선택지3", "D. 선택지4"],
      "answer": "A",
      "explanation": "해설"
    }},
    {{
      "id": 2,
      "type": "short_answer",
      "difficulty": "심화",
      "question": "질문",
      "answer": "정답",
      "explanation": "해설"
    }}
  ]
}}"""

_GRADE_PROMPT = """\
다음 단답형 문제의 학생 답변을 채점하세요.

문제: {question}
모범 정답: {correct}
학생 답변: {user}

의미상 유사하면 정답으로 처리하세요. 반드시 다음 JSON으로만 응답하세요:
{{"correct": true, "feedback": "간략한 피드백 (1~2줄)"}}"""


def generate_quiz(doc_id: str, n: int = 5, focus_difficulty: str | None = None) -> list[dict]:
    vs = get_vectorstore(doc_id)
    docs = vs.as_retriever(search_type="mmr", search_kwargs={"k": 15, "fetch_k": 40}).invoke("강의 핵심 개념")
    if not docs:
        raise ValueError("문서를 찾을 수 없습니다.")

    sample = random.sample(docs, min(12, len(docs)))
    context = "\n\n---\n\n".join(d.page_content for d in sample)

    # 적응형 난이도: 취약 난이도가 있으면 프롬프트에 추가
    focus_note = ""
    if focus_difficulty:
        focus_note = f"\n\n⚠️ 학생이 '{focus_difficulty}' 난이도에서 오답률이 높습니다. '{focus_difficulty}' 문제를 전체의 50% 이상 포함하세요."

    response = _llm().invoke(_GENERATE_PROMPT.format(n=n, context=context) + focus_note)
    return json.loads(response.content)["questions"]


def grade_short_answer(question: str, correct: str, user: str) -> dict:
    response = _llm().invoke(_GRADE_PROMPT.format(question=question, correct=correct, user=user))
    return json.loads(response.content)
