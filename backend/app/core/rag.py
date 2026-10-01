import os
from functools import lru_cache

from langchain_postgres import PGVector
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_community.embeddings import FastEmbedEmbeddings
from langchain_openai import ChatOpenAI

from .config import settings


_PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
_FALLBACK_MODELS = [
    "qwen/qwen3-30b-a3b:free",
    "meta-llama/llama-3.1-8b-instruct:free",
]


def _llm(model: str = _PRIMARY_MODEL) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        openai_api_key=settings.openrouter_api_key,
        openai_api_base="https://openrouter.ai/api/v1",
    )

_PROMPT = PromptTemplate.from_template(
    "아래 강의자료 내용을 참고하여 질문에 한국어로 답하세요. "
    "자료에 없는 내용은 '강의자료에서 찾을 수 없는 내용입니다'라고 답하세요.\n\n"
    "컨텍스트:\n{context}\n\n"
    "질문: {question}\n"
    "답변:"
)


@lru_cache(maxsize=1)
def _get_embedding() -> FastEmbedEmbeddings:
    return FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")


def _pg_conn() -> str:
    url = settings.db_connection_string.strip()
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    return url


def get_vectorstore(collection_name: str) -> PGVector:
    return PGVector(
        embeddings=_get_embedding(),
        collection_name=collection_name,
        connection=_pg_conn(),
        use_jsonb=True,
    )


def add_chunks(collection_name: str, chunks: list[str], metadatas: list[dict] | None = None) -> None:
    get_vectorstore(collection_name).add_texts(chunks, metadatas=metadatas)


def query_rag(collection_name: str, question: str) -> dict:
    vs = get_vectorstore(collection_name)
    retriever = vs.as_retriever(search_type="mmr", search_kwargs={"k": 5, "fetch_k": 20})
    llm = _llm()

    chain = (
        {"context": retriever | (lambda docs: "\n\n".join(d.page_content for d in docs)),
         "question": RunnablePassthrough()}
        | _PROMPT
        | llm
        | StrOutputParser()
    )

    source_docs = retriever.invoke(question)
    answer = chain.invoke(question)

    return {
        "answer": answer,
        "sources": [
            {"text": doc.page_content[:300], "page": doc.metadata.get("page")}
            for doc in source_docs
        ],
    }
