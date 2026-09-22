const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiFetch(url, options = {}, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + url, { signal: controller.signal, ...options });
    const data = await res.json().catch(() => ({ detail: "서버 응답을 읽을 수 없습니다." }));
    if (!res.ok) throw new Error(data.detail || `오류 ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("요청 시간이 초과됐습니다. PDF가 너무 크거나 서버가 응답하지 않습니다.");
    }
    if (err instanceof TypeError) {
      throw new Error("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
