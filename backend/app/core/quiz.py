import json
import random

from .rag import _llm, _FALLBACK_MODELS, _PRIMARY_MODEL, get_vectorstore

_RETRIABLE = ("overload", "503", "temporarily", "provider_overloaded", "unavailable for free", "404")


def _is_retriable(e: Exception) -> bool:
    return any(k in str(e).lower() for k in _RETRIABLE)

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
- 각 문제의 "concept"에는 그 문제가 확인하는 개념 이름을 짧게(2~15글자) 쓰세요.{concept_rule}

강의자료:
{context}

반드시 다음 JSON 형식으로만 응답하세요:
{{
  "questions": [
    {{
      "id": 1,
      "type": "multiple_choice",
      "difficulty": "기본",
      "concept": "개념 이름",
      "question": "질문",
      "options": ["A. 선택지1", "B. 선택지2", "C. 선택지3", "D. 선택지4"],
      "answer": "A",
      "explanation": "해설"
    }},
    {{
      "id": 2,
      "type": "short_answer",
      "difficulty": "심화",
      "concept": "개념 이름",
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


def generate_quiz(doc_id: str, n: int = 5, focus_difficulty: str | None = None, weak_hints: list[str] | None = None,
                  concepts: list[str] | None = None, focus_concept: str | None = None,
                  context_text: str | None = None) -> list[dict]:
    """context_text: 학생이 자료에서 고른 부분만으로 출제. focus_concept: 그 개념 위주로 출제."""
    if context_text and context_text.strip():
        context = context_text.strip()[:6000]
    else:
        vs = get_vectorstore(doc_id)
        query = focus_concept or "강의 핵심 개념"
        docs = vs.as_retriever(search_type="mmr", search_kwargs={"k": 15, "fetch_k": 40}).invoke(query)
        if not docs:
            raise ValueError("문서를 찾을 수 없습니다.")
        sample = docs[:8] if focus_concept else random.sample(docs, min(12, len(docs)))
        context = "\n\n---\n\n".join(d.page_content for d in sample)

    adaptive_note = ""
    if focus_difficulty:
        adaptive_note += f"\n\n⚠️ 학생이 '{focus_difficulty}' 난이도에서 오답률이 높습니다. '{focus_difficulty}' 문제를 전체의 50% 이상 포함하세요."
    if weak_hints:
        adaptive_note += "\n\n📌 아래 개념들은 이 학생이 자주 틀렸습니다. 반드시 관련 문제를 포함하세요:\n"
        adaptive_note += "\n".join(f"- {q[:100]}" for q in weak_hints)

    if focus_concept:
        adaptive_note += f"\n\n🎯 모든 문제를 '{focus_concept}' 개념을 확인하는 문제로 내세요. concept 값은 '{focus_concept}'로 쓰세요."
    concept_rule = ""
    if concepts and not focus_concept:
        concept_rule = " 가능하면 다음 목록의 이름 중 하나를 그대로 쓰세요: " + ", ".join(concepts[:10])

    from .learning import parse_json
    prompt = _GENERATE_PROMPT.format(n=n, context=context, concept_rule=concept_rule) + adaptive_note
    for model in [_PRIMARY_MODEL] + _FALLBACK_MODELS:
        try:
            response = _llm(model).invoke(prompt)
            data = parse_json(response.content)
            questions = data["questions"] if isinstance(data, dict) else data
            out = []
            for i, q in enumerate(questions, 1):
                if not isinstance(q, dict) or not q.get("question") or "answer" not in q:
                    continue
                q["id"] = i
                q["type"] = "multiple_choice" if q.get("type") == "multiple_choice" and q.get("options") else "short_answer"
                q["answer"] = str(q["answer"])
                q.setdefault("explanation", "")
                if focus_concept:
                    q["concept"] = focus_concept
                out.append(q)
            if out:
                return out
        except Exception as e:
            if _is_retriable(e) or isinstance(e, (ValueError, KeyError, TypeError)):
                continue
            raise
    raise ValueError("AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.")


def grade_short_answer(question: str, correct: str, user: str) -> dict:
    last_err = None
    for model in [_PRIMARY_MODEL] + _FALLBACK_MODELS:
        try:
            from .learning import parse_json
            response = _llm(model).invoke(_GRADE_PROMPT.format(question=question, correct=correct, user=user))
            data = parse_json(response.content)
            return {"correct": bool(data.get("correct")), "feedback": str(data.get("feedback", ""))}
        except Exception as e:
            if _is_retriable(e):
                last_err = e
                continue
            raise
    raise ValueError("채점 서버가 과부하 상태입니다.")
