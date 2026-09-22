import json
import random

from langchain_groq import ChatGroq

from .config import settings
from .rag import get_vectorstore

_GENERATE_PROMPT = """\
당신은 대학 강의자료 기반 퀴즈 출제 전문가입니다.
아래 강의자료 내용을 바탕으로 {n}개의 퀴즈를 출제하세요.
객관식(4지선다)과 단답형을 적절히 혼합하고 강의의 핵심 개념을 다루세요.

강의자료:
{context}

반드시 다음 JSON 형식으로만 응답하세요:
{{
  "questions": [
    {{
      "id": 1,
      "type": "multiple_choice",
      "question": "질문",
      "options": ["A. 선택지1", "B. 선택지2", "C. 선택지3", "D. 선택지4"],
      "answer": "A",
      "explanation": "해설"
    }},
    {{
      "id": 2,
      "type": "short_answer",
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


def _llm() -> ChatGroq:
    return ChatGroq(model="llama-3.1-8b-instant", api_key=settings.groq_api_key)


def generate_quiz(doc_id: str, n: int = 5) -> list[dict]:
    vs = get_vectorstore(doc_id)
    all_docs = vs.get()["documents"]
    if not all_docs:
        raise ValueError("문서를 찾을 수 없습니다.")

    sample = random.sample(all_docs, min(12, len(all_docs)))
    context = "\n\n---\n\n".join(sample)

    response = _llm().invoke(_GENERATE_PROMPT.format(n=n, context=context))
    return json.loads(response.content)["questions"]


def grade_short_answer(question: str, correct: str, user: str) -> dict:
    response = _llm().invoke(_GRADE_PROMPT.format(question=question, correct=correct, user=user))
    return json.loads(response.content)
