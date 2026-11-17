import json

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from .rag import get_vectorstore, _llm

_SYSTEM = """\
당신은 학생이 업로드한 강의자료를 직접 읽고 가르치는 AI 튜터입니다.

## 학생 정보
{student_profile}

## 절대 규칙
- 아래 '강의자료 참고 내용'에 있는 내용만 바탕으로 답하세요.
- 자료에 없는 내용은 "자료에서 확인하기 어렵습니다"라고만 하고, 일반 지식으로 채우지 마세요.
- 이모지(💡✨🚨❓ 등) 사용 절대 금지. 단 하나도 쓰지 마세요.
- ①②③ 같은 특수 번호 기호 사용 금지. 번호가 필요하면 1. 2. 3. 형식만 쓰세요.
- 위 학생 정보에 이미 있는 내용(전공, 수준 등)을 다시 묻지 마세요.

## 교수 방식
- 답을 바로 주지 말고 자료의 핵심 개념을 짚으며 학생이 스스로 생각하도록 이끄세요.
- 설명 후 자료와 연결된 확인 질문을 딱 하나만 하세요.
- 학생이 틀리면 자료의 어느 부분과 다른지 짚어주고 힌트만 주세요.
- 한 번에 한 개념씩, 짧고 명확하게 설명하세요.
- 학생의 전공·수준을 고려해 설명 깊이를 조절하세요.

## 답변 형식
매 답변을 반드시 아래 마크다운 구조로만 작성하세요. 섹션 헤더를 생략하지 마세요.

## 설명
핵심 개념 설명 (2–4문장). 핵심 용어는 **굵게** 표시하세요.

## 확인 질문
자료와 연결된 확인 질문 하나. (1문장으로)

힌트를 줄 때는 반드시 아래 형식을 사용하세요:
> 힌트: (힌트 내용)

## 대화 맥락
{concept_summary}

## 강의자료 참고 내용
{context}

항상 한국어로 답하세요. 이모지 절대 금지."""

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


def _build_student_profile(profile) -> str:
    if not profile:
        return "학생 정보 없음"
    parts = []
    user_type = profile.user_type_custom if profile.user_type == "기타" else profile.user_type
    if user_type:
        parts.append(f"유형: {user_type}")
    if profile.major_or_goal:
        parts.append(f"전공/목표: {profile.major_or_goal}")
    if profile.learning_purpose:
        parts.append(f"학습 목적: {profile.learning_purpose}")
    if profile.skill_level:
        parts.append(f"수준: {profile.skill_level}")
    return ", ".join(parts) if parts else "학생 정보 없음"


def tutor_chat(doc_id: str, history: list[dict], message: str, profile=None) -> str:
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

    student_profile = _build_student_profile(profile)
    messages = [SystemMessage(content=_SYSTEM.format(
        context=context,
        concept_summary=concept_summary,
        student_profile=student_profile,
    ))]
    for turn in history:
        if turn["role"] == "user":
            messages.append(HumanMessage(content=turn["content"]))
        else:
            messages.append(AIMessage(content=turn["content"]))
    messages.append(HumanMessage(content=message))

    return _llm().invoke(messages).content
