import pdfplumber
from langchain_text_splitters import RecursiveCharacterTextSplitter


def extract_text(file_path: str) -> str:
    with pdfplumber.open(file_path) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n\n".join(p for p in pages if p.strip())


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 150) -> list[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        separators=["\n\n", "\n", ".", " ", ""],
    )
    return splitter.split_text(text)
