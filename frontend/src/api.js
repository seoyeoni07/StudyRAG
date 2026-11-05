export const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

let _uid = null;
export function setUserId(uid) { _uid = uid; }

export class ColdStartError extends Error {
  constructor() {
    super("서버를 시작하는 중입니다. 잠시 후 다시 시도해주세요.");
    this.isColdStart = true;
  }
}

// Render free-tier cold-start: server returns 503 without CORS headers,
// surfaces as TypeError("Failed to fetch").
// Retry for up to ~90s (18 × 5s) before giving up.
async function fetchWithRetry(url, options, signal, maxAttempts = 18, delay = 5000) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { ...options, signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (!(err instanceof TypeError)) throw err;
      if (attempt >= maxAttempts - 1) throw new ColdStartError();
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
    if (err.name === "AbortError") throw new Error("요청 시간이 초과됐습니다.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 파일 내려받기 (CSV 등) — 로그인 헤더가 필요해서 <a href> 대신 fetch로 받는다 */
export async function apiDownload(url, fallbackName = "download") {
  const headers = {};
  if (_uid) headers["X-User-ID"] = _uid;
  const res = await fetch(BASE + url, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `오류 ${res.status}`);
  }
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
