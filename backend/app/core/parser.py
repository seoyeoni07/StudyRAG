import pdfplumber
from langchain_text_splitters import RecursiveCharacterTextSplitter

_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=150,
    separators=["\n\n", "\n", ".", " ", ""],
)

_VISION_MODELS = [
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen2-vl-7b-instruct:free",
]
_RETRIABLE_VISION = ("overload", "503", "temporarily", "unavailable", "404")


def _image_to_b64_png(image) -> str:
    import io, base64
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _ocr_page_vision(image) -> str:
    """PIL Image → Vision LLM 텍스트 추출"""
    from langchain_core.messages import HumanMessage
    from .rag import _llm
    b64 = _image_to_b64_png(image)
    msg = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        {"type": "text", "text": "이 페이지의 모든 텍스트를 빠짐없이 추출해주세요."},
    ])
    for model in _VISION_MODELS:
        try:
            return _llm(model).invoke([msg]).content
        except Exception:
            continue
    return ""


def _ocr_page(image) -> str:
    try:
        import pytesseract
        text = pytesseract.image_to_string(image, lang="kor+eng")
        if text.strip():
            return text
    except Exception:
        pass
    return _ocr_page_vision(image)


def _get_page_images(file_path: str):
    """PDF 페이지 이미지 목록 반환. pdf2image → PyMuPDF 순서로 시도."""
    try:
        from pdf2image import convert_from_path
        return convert_from_path(file_path)
    except Exception:
        pass
    try:
        import fitz  # PyMuPDF
        import io
        from PIL import Image
        doc = fitz.open(file_path)
        images = []
        for page in doc:
            pix = page.get_pixmap(dpi=150)
            images.append(Image.open(io.BytesIO(pix.tobytes("png"))))
        doc.close()
        return images
    except Exception:
        return None


def _page_text(page, idx: int, ocr_images: list | None) -> str:
    text = page.extract_text() or ""
    if len(text.strip()) < 50 and ocr_images and idx < len(ocr_images):
        text = _ocr_page(ocr_images[idx])
    return text


def extract_chunks_with_pages(file_path: str) -> list[tuple[str, int]]:
    ocr_images = _get_page_images(file_path)

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


def extract_text_from_image(image_data: bytes, content_type: str) -> str:
    """Vision LLM으로 이미지에서 텍스트/내용 추출"""
    import base64
    from langchain_core.messages import HumanMessage
    from .rag import _llm

    b64 = base64.b64encode(image_data).decode()
    msg = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}},
        {"type": "text", "text": (
            "이 이미지의 모든 텍스트와 내용을 빠짐없이 추출하고 정리해주세요. "
            "표, 수식, 도표도 텍스트로 변환하세요. "
            "텍스트가 없으면 이미지 내용을 자세히 설명해주세요."
        )},
    ])
    last_err = None
    for model in _VISION_MODELS:
        try:
            return _llm(model).invoke([msg]).content
        except Exception as e:
            if any(k in str(e).lower() for k in _RETRIABLE_VISION):
                last_err = e
                continue
            raise
    raise ValueError("이미지 분석 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.")
