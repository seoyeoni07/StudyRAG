import os
from functools import lru_cache

from langchain_chroma import Chroma
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_community.embeddings import FastEmbedEmbeddings
from langchain_groq import ChatGroq

from .config import settings

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


def get_vectorstore(collection_name: str) -> Chroma:
    return Chroma(
        collection_name=collection_name,
        embedding_function=_get_embedding(),
        persist_directory=settings.chroma_persist_dir,
    )


def add_chunks(collection_name: str, chunks: list[str], metadatas: list[dict] | None = None) -> None:
    get_vectorstore(collection_name).add_texts(chunks, metadatas=metadatas)


def query_rag(collection_name: str, question: str) -> dict:
    vs = get_vectorstore(collection_name)
    retriever = vs.as_retriever(search_type="mmr", search_kwargs={"k": 5, "fetch_k": 20})
    llm = ChatGroq(model="llama3-8b-8192", api_key=settings.groq_api_key)

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
        "sources": [doc.page_content[:300] for doc in source_docs],
    }
