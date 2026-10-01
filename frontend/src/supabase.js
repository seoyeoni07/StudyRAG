import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 실시간 기능(접속자 표시, 공동 편집, 업로드 알림)에만 쓴다. 데이터 저장은 백엔드 API가 맡는다.
// 환경변수가 없으면 null — 앱은 실시간 없이 동작한다.
export const supabase = url && anonKey
  ? createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 20 } } })
  : null;
