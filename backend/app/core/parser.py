import pdfplumber
from langchain_text_splitters import RecursiveCharacterTextSplitter

_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=150,
    separators=["\n\n", "\n", ".", " ", ""],
)

_OPENROUTER_VISION_MODELS = [
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "meta-llama/llama-3.2-90b-vision-instruct:free",
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


def _gemini_vision(b64: str, prompt: str) -> str:
    """Google Gemini Vision (무료 tier: 분당 15회)"""
    from ..core.config import settings
    if not settings.google_api_key:
        return ""
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_core.messages import HumanMessage
        llm = ChatGoogleGenerativeAI(model="gemini-3.8-flash", google_api_key=settings.google_api_key)
        msg = HumanMessage(content=[
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": prompt},
        ])
        content = llm.invoke([msg]).content
        if isinstance(content, list):
            return " ".join(
                p if isinstance(p, str)
                else (p.get("text", "") if isinstance(p, dict) else str(p))
                for p in content
            )
        return str(content) if content else ""
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Gemini vision failed: %s", e)
        return ""


def _ocr_page_vision(image) -> str:
    """PIL Image → Vision LLM 텍스트 추출 (Gemini → OpenRouter 순)"""
    from langchain_core.messages import HumanMessage
    from .rag import _llm
    import logging
    log = logging.getLogger(__name__)

    b64 = _image_to_b64_jpeg(image)
    prompt = "Extract ALL text from this image exactly as written. Include every word, number, and label visible."

    text = _gemini_vision(b64, prompt)
    if text.strip():
        return text

    msg = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
        {"type": "text", "text": prompt},
    ])
    for model in _OPENROUTER_VISION_MODELS:
        try:
            text = _llm(model).invoke([msg]).content
            if text.strip():
                return text
            log.warning("Vision LLM %s returned empty", model)
        except Exception as e:
            log.warning("Vision LLM %s failed: %s: %s", model, type(e).__name__, e)
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
    """Vision LLM으로 이미지에서 텍스트/내용 추출 (Gemini → OpenRouter 순)"""
    import io, logging
    from PIL import Image
    from langchain_core.messages import HumanMessage
    from .rag import _llm
    log = logging.getLogger(__name__)

    img = Image.open(io.BytesIO(image_data))
    b64 = _image_to_b64_jpeg(img)
    prompt = (
        "Extract ALL text from this image exactly as written. "
        "Include every word, number, label, and caption visible. "
        "If there is no text, describe the image content in detail."
    )

    # 1순위: Gemini
    text = _gemini_vision(b64, prompt)
    if text.strip():
        return text

    # 2순위: OpenRouter llama
    msg = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
        {"type": "text", "text": prompt},
    ])
    last_err = None
    for model in _OPENROUTER_VISION_MODELS:
        try:
            text = _llm(model).invoke([msg]).content
            if text.strip():
                return text
            log.warning("Vision LLM %s returned empty", model)
            last_err = ValueError("empty response")
        except Exception as e:
            log.warning("Vision LLM %s failed: %s: %s", model, type(e).__name__, e)
            last_err = e
    raise ValueError(f"모든 Vision 모델 실패. 마지막 에러: {last_err}")
