export async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({ detail: "서버 응답을 읽을 수 없습니다." }));
    if (!res.ok) throw new Error(data.detail || `오류 ${res.status}`);
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
    }
    throw err;
  }
}
