from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from .rag import get_vectorstore, _llm

_SYSTEM = (
    "당신은 강의자료를 기반으로 학생을 직접 가르치는 AI 튜터입니다. "
    "답을 바로 주지 말고 소크라테스식으로 가르치세요:\n"
    "1. 학생이 무엇을 알고 있는지 먼저 확인하세요.\n"
    "2. 개념을 단계별로 설명하되, 중간마다 이해했는지 질문을 던지세요.\n"
    "3. 학생이 틀리면 직접 답을 주지 말고 힌트를 주세요.\n"
    "4. 설명이 끝나면 연관 개념 질문으로 이어가세요.\n"
    "5. 항상 한국어로 답하세요.\n"
    "강의자료 컨텍스트:\n{context}"
)


def tutor_chat(doc_id: str, history: list[dict], message: str) -> str:
    vs = get_vectorstore(doc_id)
    retriever = vs.as_retriever(search_type="mmr", search_kwargs={"k": 4, "fetch_k": 15})

    docs = retriever.invoke(message)
    context = "\n\n".join(d.page_content for d in docs)

    messages = [SystemMessage(content=_SYSTEM.format(context=context))]
    for turn in history:
        if turn["role"] == "user":
            messages.append(HumanMessage(content=turn["content"]))
        else:
            messages.append(AIMessage(content=turn["content"]))
    messages.append(HumanMessage(content=message))

    return _llm().invoke(messages).content
