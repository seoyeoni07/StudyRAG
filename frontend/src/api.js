const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

let _uid = null;
export function setUserId(uid) { _uid = uid; }

// Render free-tier cold-start: server returns 503 without CORS headers,
// which the browser sees as TypeError("Failed to fetch").
// We retry for up to ~90 seconds (18 attempts × 5s) before giving up.
async function fetchWithRetry(url, options, signal, maxAttempts = 18, delay = 5000) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal });
      return res;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (!(err instanceof TypeError)) throw err;
      if (attempt >= maxAttempts - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

export async function apiFetch(url, options = {}, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(options.headers || {}) };
    if (_uid) headers["X-User-ID"] = _uid;
    const res = await fetchWithRetry(BASE + url, { ...options, headers }, controller.signal);
    const data = await res.json().catch(() => ({ detail: "서버 응답을 읽을 수 없습니다." }));
    if (!res.ok) throw new Error(data.detail || `오류 ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("요청 시간이 초과됐습니다.");
    }
    if (err instanceof TypeError) {
      throw new Error("__cold_start__");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
