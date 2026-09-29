import pdfplumber
from langchain_text_splitters import RecursiveCharacterTextSplitter

_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=150,
    separators=["\n\n", "\n", ".", " ", ""],
)


def _ocr_page(image):
    try:
        import pytesseract
        return pytesseract.image_to_string(image, lang="kor+eng")
    except Exception:
        return ""


def _page_text(page, idx: int, ocr_images: list | None) -> str:
    text = page.extract_text() or ""
    if len(text.strip()) < 50 and ocr_images and idx < len(ocr_images):
        text = _ocr_page(ocr_images[idx])
    return text


def extract_chunks_with_pages(file_path: str) -> list[tuple[str, int]]:
    ocr_images = None
    try:
        from pdf2image import convert_from_path
        ocr_images = convert_from_path(file_path)
    except Exception:
        pass

    result: list[tuple[str, int]] = []
    with pdfplumber.open(file_path) as pdf:
        for idx, page in enumerate(pdf.pages):
            text = _page_text(page, idx, ocr_images)
            if not text.strip():
                continue
            for chunk in _SPLITTER.split_text(text):
                result.append((chunk, idx + 1))
    return result


# kept for backward compat
def extract_text(file_path: str) -> str:
    chunks = extract_chunks_with_pages(file_path)
    return "\n\n".join(c for c, _ in chunks)


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 150) -> list[str]:
    return _SPLITTER.split_text(text)
