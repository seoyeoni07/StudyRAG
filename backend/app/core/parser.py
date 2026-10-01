import pdfplumber
from langchain_text_splitters import RecursiveCharacterTextSplitter

_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=150,
    separators=["\n\n", "\n", ".", " ", ""],
)

_VISION_MODELS = [
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "meta-llama/llama-3.2-90b-vision-instruct:free",
    "qwen/qwen2-vl-7b-instruct:free",
]
_RETRIABLE_VISION = ("overload", "503", "temporarily", "unavailable", "404")


def _image_to_b64_jpeg(image, max_px=1024, quality=75) -> str:
    """PIL Image → JPEG base64 (크기/용량 최소화)"""
    import io, base64
    from PIL import Image
    w, h = image.size
    if max(w, h) > max_px:
        ratio = max_px / max(w, h)
        image = image.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    if image.mode != "RGB":
        image = image.convert("RGB")
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode()


def _ocr_page_vision(image) -> str:
    """PIL Image → Vision LLM 텍스트 추출"""
    from langchain_core.messages import HumanMessage
    from .rag import _llm
    b64 = _image_to_b64_jpeg(image)
    msg = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        {"type": "text", "text": "이 페이지의 모든 텍스트를 빠짐없이 추출해주세요."},
    ])
    for model in _VISION_MODELS:
        try:
            text = _llm(model).invoke([msg]).content
            if text.strip():
                return text
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
        return convert_from_path(file_path, dpi=100)
    except Exception:
        pass
    try:
        import fitz  # PyMuPDF
        import io
        from PIL import Image
        doc = fitz.open(file_path)
        images = []
        for page in doc:
            pix = page.get_pixmap(dpi=100)
            images.append(Image.open(io.BytesIO(pix.tobytes("png"))))
        doc.close()
        return images
    except Exception:
        return None


def _page_text(page, idx: int, ocr_images: list | None) -> str:
    text = page.extract_text() or ""
    # 텍스트가 전혀 없을 때만 Vision LLM OCR (부분 텍스트도 활용)
    if not text.strip() and ocr_images and idx < len(ocr_images):
        text = _ocr_page(ocr_images[idx])
    return text


def extract_chunks_with_pages(file_path: str) -> list[tuple[str, int]]:
    import logging
    log = logging.getLogger(__name__)

    ocr_images = _get_page_images(file_path)
    log.info("PDF OCR images available: %s", ocr_images is not None and len(ocr_images))

    result: list[tuple[str, int]] = []
    with pdfplumber.open(file_path) as pdf:
        for idx, page in enumerate(pdf.pages):
            text = _page_text(page, idx, ocr_images)
            log.info("Page %d text len: %d", idx + 1, len(text.strip()))
            if not text.strip():
                continue
            for chunk in _SPLITTER.split_text(text):
                result.append((chunk, idx + 1))
    log.info("Total chunks: %d", len(result))
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
            text = _llm(model).invoke([msg]).content
            if text.strip():
                return text
            last_err = ValueError("empty response")
        except Exception as e:
            last_err = e
            continue  # 어떤 에러든 다음 모델로
    raise ValueError("이미지 분석 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.")
