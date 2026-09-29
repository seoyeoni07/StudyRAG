import json

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from .rag import get_vectorstore, _llm

_SYSTEM = """\
당신은 강의자료를 바탕으로 학생을 직접 가르치는 AI 튜터입니다.

## 교수 원칙
- 답을 바로 알려주지 말고, 학생이 스스로 생각하게 이끄세요.
- 설명 후 반드시 이해 확인 질문을 하나 던지세요 ("~는 왜 그럴까요?", "한번 예를 들어볼 수 있을까요?").
- 학생이 틀리면 "틀렸어요"가 아니라 어디서 헷갈렸는지 짚어주고 힌트만 주세요.
- 학생이 맞히면 칭찬한 뒤 연관 개념으로 자연스럽게 이어가세요.
- 처음 질문이면 학생이 이미 아는 것을 먼저 물어보세요.
- 한 번에 너무 많은 내용을 주지 말고 작은 단계로 나누어 가르치세요.

## 대화 맥락
{concept_summary}

## 강의자료 참고 내용
{context}

항상 한국어로 답하세요."""

_SUMMARY_PROMPT = """\
다음 튜터-학생 대화에서 학생이 이해한 개념과 아직 불확실한 개념을 JSON으로 정리하세요.

대화:
{dialogue}

반드시 다음 JSON 형식으로만 응답하세요:
{{"understood": ["개념1", "개념2"], "unclear": ["개념3"]}}"""


def summarize_concepts(history: list[dict]) -> dict:
    if not history:
        return {"understood": [], "unclear": []}
    dialogue = "\n".join(
        f"{'학생' if t['role'] == 'user' else '튜터'}: {t['content']}"
        for t in history[-20:]
    )
    try:
        return json.loads(_llm().invoke(_SUMMARY_PROMPT.format(dialogue=dialogue)).content)
    except Exception:
        return {"understood": [], "unclear": []}


def tutor_chat(doc_id: str, history: list[dict], message: str) -> str:
    vs = get_vectorstore(doc_id)
    retriever = vs.as_retriever(search_type="mmr", search_kwargs={"k": 4, "fetch_k": 15})
    docs = retriever.invoke(message)
    context = "\n\n".join(d.page_content for d in docs)

    # 대화 히스토리에서 개념 파악 요약 (5턴 이상일 때만)
    concept_summary = ""
    if len(history) >= 10:
        dialogue = "\n".join(
            f"{'학생' if t['role'] == 'user' else '튜터'}: {t['content']}"
            for t in history[-10:]
        )
        try:
            result = json.loads(_llm().invoke(_SUMMARY_PROMPT.format(dialogue=dialogue)).content)
            understood = result.get("understood", [])
            unclear = result.get("unclear", [])
            if understood:
                concept_summary += f"학생이 이해한 개념: {', '.join(understood)}\n"
            if unclear:
                concept_summary += f"아직 불확실한 개념: {', '.join(unclear)} → 이 부분을 집중적으로 도와주세요.\n"
        except Exception:
            pass

    messages = [SystemMessage(content=_SYSTEM.format(context=context, concept_summary=concept_summary))]
    for turn in history:
        if turn["role"] == "user":
            messages.append(HumanMessage(content=turn["content"]))
        else:
            messages.append(AIMessage(content=turn["content"]))
    messages.append(HumanMessage(content=message))

    return _llm().invoke(messages).content
