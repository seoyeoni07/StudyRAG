import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, logout } from "./firebase";
import { apiFetch, setUserId } from "./api";
import QASection from "./components/QASection";
import QuizSection from "./components/QuizSection";
import WrongAnswerBook from "./components/WrongAnswerBook";
import TutorSection from "./components/TutorSection";
import SummarySection from "./components/SummarySection";
import StudyRoomSection from "./components/StudyRoomSection";
import DashboardHome from "./components/DashboardHome";
import LandingPage from "./components/LandingPage";
import PublicNotePage from "./components/PublicNotePage";
import StatsSection from "./components/StatsSection";
import SourceViewer from "./components/learn/SourceViewer";
import MasteryMap from "./components/learn/MasteryMap";
import WeakConcepts from "./components/learn/WeakConcepts";
import { CardDeck } from "./components/learn/Flashcards";
import { generateCards, generateQuiz } from "./components/learn/learnApi";
import SettingsPage from "./components/SettingsPage";
import LoginPage from "./components/LoginPage";
import Sidebar, { tabsFor } from "./components/Sidebar";
import { ancestorsOf } from "./components/NoteTree";
import { NoteIcon, DocIcon, renderNoteIcon, KeyIcon, ShareIcon, UsersIcon, SparkleIcon, MessageIcon } from "./components/Icons.jsx";
import GroupHome, { GroupStart, timeAgo as groupTimeAgo } from "./components/GroupHome";
import ChatApp from "./components/ChatApp";
import ChatWidget from "./components/chat/ChatWidget";
import { useDmRooms, refreshDmRooms, resetDmStore, isRoomOpen, touchDmRoom, badgeCount } from "./realtime/dmStore";
import { sendBroadcast } from "./realtime/chatBus";
import { useGroupChannels } from "./realtime/useGroupChannels";
import { supabase } from "./supabase";
import "./App.css";

// ── 해시 라우팅 헬퍼 ────────────────────────────────────────────────
function viewToHash(v) {
  if (!v) return "#home";
  switch (v.type) {
    case "home":        return "#home";
    case "planner":     return v.groupId ? `#group/${v.groupId}/planner` : "#planner";
    case "stats":       return "#stats";
    case "cards":       return "#cards";
    case "exam":        return v.prepId ? `#exam/${v.prepId}` : "#exam";
    case "settings":    return "#settings";
    case "chat":        return "#chat";
    case "group-start": return "#group-start";
    case "group":       return `#group/${v.groupId}`;
    case "note":        return `#note/${v.noteId}`;
    case "gnote":       return `#group/${v.groupId}/note/${v.noteId}`;
    case "doc":         return v.groupId
      ? `#group/${v.groupId}/doc/${v.docId}/${v.tab || "summary"}`
      : `#doc/${v.docId}/${v.tab || "summary"}`;
    default:            return "#home";
  }
}

function hashToView(hash) {
  const h = (hash || "").replace(/^#/, "");
  if (!h || h === "home") return { type: "home" };
  const p = h.split("/");
  switch (p[0]) {
    case "planner":     return { type: "planner" };
    case "stats":       return { type: "stats" };
    case "cards":       return { type: "cards" };
    case "exam":        return p[1] ? { type: "exam", prepId: p[1] } : { type: "exam" };
    case "settings":    return { type: "settings" };
    case "chat":        return { type: "chat" };
    case "group-start": return { type: "group-start" };
    case "note":        return p[1] ? { type: "note", noteId: p[1] } : { type: "home" };
    case "doc":         return p[1] ? { type: "doc", docId: p[1], tab: p[2] || "summary" } : { type: "home" };
    case "group": {
      if (!p[1]) return { type: "home" };
      const gid = p[1];
      if (!p[2])              return { type: "group", groupId: gid };
      if (p[2] === "planner") return { type: "planner", groupId: gid };
      if (p[2] === "note")    return p[3] ? { type: "gnote", groupId: gid, noteId: p[3] } : { type: "group", groupId: gid };
      if (p[2] === "doc")     return p[3] ? { type: "doc", docId: p[3], tab: p[4] || "summary", groupId: gid } : { type: "group", groupId: gid };
      return { type: "group", groupId: gid };
    }
    default: return { type: "home" };
  }
}

// 블록 에디터(BlockNote)는 무거워서 공동 노트를 열 때만 불러온다
const GroupNotePage = lazy(() => import("./components/GroupNotePage"));
const NotePage = lazy(() => import("./components/NotePage"));
const PlannerPage = lazy(() => import("./components/planner/PlannerPage"));
const FlashcardsPage = lazy(() => import("./components/learn/Flashcards"));
const ExamPage = lazy(() => import("./components/learn/ExamPage"));

// 같은 파일명이 여러 번 업로드된 경우 가장 최신 1개만 유지
const dedupDocs = (docs) => {
  const seen = new Set();
  return docs.filter(d => seen.has(d.filename) ? false : seen.add(d.filename));
};

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

export default function App() {
  const [user, setUser] = useState(undefined);
  // view: { type: "home" } | { type: "doc", docId, filename, tab, groupId? } | { type: "note", noteId }
  //     | { type: "group-start" } | { type: "group", groupId } | { type: "gnote", groupId, noteId }
  const [view, setView] = useState(() => { try { return hashToView(window.location.hash); } catch { return { type: "home" }; } });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pastDocs, setPastDocs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [wrongCount, setWrongCount] = useState(0);
  const [preJoined, setPreJoined] = useState(null);
  const [serverWaking, setServerWaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } });
  const [groups, setGroups] = useState([]);
  const [groupData, setGroupData] = useState({}); // { [groupId]: { detail, docs, notes } }
  const [groupUploading, setGroupUploading] = useState(null);
  const [groupQuiz, setGroupQuiz] = useState({}); // { [groupId]: 열린 그룹 퀴즈 방 정보 }
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [reviewDue, setReviewDue] = useState(0);
  const [sharedNotes, setSharedNotes] = useState([]);
  // 안 읽은 DM 수 — 사이드바·작은 채팅창·큰 채팅창이 같은 숫자를 쓴다 (realtime/dmStore)
  const dmUnread = badgeCount(useDmRooms());
  const [streak, setStreak] = useState(0);
  const [wrongRefreshKey, setWrongRefreshKey] = useState(0);
  const [quizInitialSession, setQuizInitialSession] = useState(null);
  const [source, setSource] = useState(null);       // 근거 보기 창 { docId, page, quote, filename }
  const [cardsDue, setCardsDue] = useState(0);      // 오늘 복습할 플래시카드
  const [cardDecks, setCardDecks] = useState([]);   // 사이드바 플래시카드 모음 (자료·노트별)
  const [cardsKey, setCardsKey] = useState(0);      // 플래시카드 화면 새로고침
  const [cardsSeen, setCardsSeen] = useState(() => {  // 플래시카드 화면에서 본 개수 { date, count }
    try { return JSON.parse(localStorage.getItem("cardsSeen") || "null"); } catch { return null; }
  });
  const [learnKey, setLearnKey] = useState(0);      // 약점 지도·카드 새로고침
  // 비로그인 상태에서 랜딩/로그인 전환
  const [preAuthView, setPreAuthView] = useState(() =>
    window.location.hash === "#login" ? "login" : "landing"
  );
  // 비로그인 상태에서 공개 노트 URL 진입 시 확인
  const [publicNote, setPublicNote] = useState(() => {
    const h = window.location.hash;
    if (h.startsWith("#note/")) {
      const id = h.slice(6);
      return id ? { id, status: "loading", data: null } : null;
    }
    return null;
  });

  const loadGroup = useCallback(async (id) => {
    try {
      const [detail, docs, gnotes] = await Promise.all([
        apiFetch(`/groups/${id}`), apiFetch(`/groups/${id}/documents`), apiFetch(`/groups/${id}/notes`),
      ]);
      setGroupData(d => ({ ...d, [id]: { detail, docs, notes: gnotes } }));
    } catch { /* 권한이 없어졌거나 서버 기동 중 */ }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const list = await apiFetch("/groups/");
      setGroups(list);
      list.forEach(g => loadGroup(g.id));
    } catch { /* 무시 */ }
  }, [loadGroup]);

  // target: 알림을 눌렀을 때 열 화면 (자료·노트·그룹 홈)
  const pushNotif = (text, groupId, target, icon) =>
    setNotifications(prev => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text, groupId, target, icon, time: new Date().toISOString(), unread: true,
    }, ...prev].slice(0, 50));

  async function approveAccess(notif) {
    const { noteId, fromId, fromName, noteTitle } = notif.target;
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, action: "approving" } : n));
    try {
      await apiFetch(`/notes/${noteId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: fromId }),
      });
      sendBroadcast(`inbox:${fromId}`, "note-access-granted", {
        note_id: noteId, title: noteTitle,
        from: user?.displayName || user?.email?.split("@")[0] || "소유자",
      });
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, action: "approved", unread: false } : n));
    } catch {
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, action: null } : n));
      setToast("공유에 실패했어요. 다시 시도해주세요.");
    }
  }

  function denyAccess(notif) {
    const { fromId, noteTitle } = notif.target;
    sendBroadcast(`inbox:${fromId}`, "note-access-denied", { title: noteTitle });
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, action: "denied", unread: false } : n));
  }

  // 공유받은 노트 목록을 새로 받고, 처음 보는 노트는 🔔 알림에 남긴다.
  // (내가 꺼져 있을 때 공유된 노트도 다음 접속 때 알림으로 보이게 — 본 적 있는 목록은 브라우저에 기억)
  const syncShared = useCallback(async (fromNames = {}) => {
    if (!user?.uid) return;
    try {
      const list = await apiFetch("/notes/shared-with-me");
      setSharedNotes(list);
      const key = `studyrag:shared-known:${user.uid}`;
      let known = null;
      try { known = JSON.parse(localStorage.getItem(key)); } catch { /* 없음 */ }
      if (Array.isArray(known)) {   // 맨 처음엔 기존 공유 노트를 한꺼번에 알리지 않는다
        list.filter(n => !known.includes(n.id)).forEach(n => {
          const from = fromNames[n.id];
          const title = n.title || "제목 없음";
          pushNotif(from ? `${from}님이 "${title}" 노트를 공유했어요` : `새로 공유받은 노트: "${title}"`,
            null, { type: "note", noteId: n.id }, "share");
        });
      }
      try { localStorage.setItem(key, JSON.stringify(list.map(n => n.id))); } catch { /* 저장 못 해도 동작 */ }
    } catch { /* 서버 기동 중 등 — 다음에 다시 */ }
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const myGroupNameFor = (gid) =>
    groupData[gid]?.detail?.members?.find(m => m.user_id === user?.uid)?.display_name;

  const { online, notify, setViewing, refreshName, enabled: realtime } = useGroupChannels(groups, user, (groupId, ev) => {
    loadGroup(groupId);
    // 같은 계정의 다른 탭·기기에서 한 일은 알리지 않는다 (broadcast self:false는 같은 연결만 제외)
    if (ev.by && ev.by === user?.uid) return;
    let msg = "";
    let target = { type: "group", groupId };
    if (ev.event === "doc-added" && ev.doc_id) target = { type: "doc", docId: ev.doc_id, filename: ev.filename, groupId, tab: "summary" };
    if (ev.event === "note-added" && ev.note_id) target = { type: "gnote", groupId, noteId: ev.note_id };
    let icon = "group";
    if (ev.event === "doc-added")     msg = `${ev.by_name}님이 "${ev.filename}" 자료를 올렸어요`;
    else if (ev.event === "note-added")   { msg = `${ev.by_name}님이 새 공동 노트를 만들었어요`; icon = "note"; }
    else if (ev.event === "member-joined") msg = `${ev.by_name}님이 그룹에 참가했어요`;
    else if (ev.event === "quiz-room") {
      setGroupQuiz(q => ({ ...q, [groupId]: ev }));
      msg = `${ev.by_name}님이 그룹 퀴즈 방을 열었어요 (코드 ${ev.code})`;
      icon = "quiz";
    }
    if (msg) { setToast(msg); pushNotif(msg, groupId, target, icon); }
  }, myGroupNameFor);

  useEffect(() => {
    if (view.type !== "cards") return;
    const seen = { date: new Date().toLocaleDateString("sv-SE"), count: cardsDue };
    setCardsSeen(seen);
    try { localStorage.setItem("cardsSeen", JSON.stringify(seen)); } catch { /* 저장 못 해도 동작 */ }
  }, [view.type, cardsDue]);

  // 그룹 멤버 목록을 불러오면 presence 이름을 그룹 표시 이름으로 맞춘다 (같은 이름이면 다시 안 보냄)
  useEffect(() => {
    groups.forEach(g => refreshName(g.id));
  }, [groupData, groups, refreshName]);

  // 전역 DM inbox 구독 — 채팅창 밖에서도 새 메시지 알림
  useEffect(() => {
    if (!supabase || !user?.uid) return;
    const ch = supabase.channel(`inbox:${user.uid}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "dm-notif" }, ({ payload }) => {
      if (isRoomOpen(payload.room_id)) {
        // 지금 그 대화방을 보고 있다 — 알림·배지 없이 목록 순서만 갱신
        touchDmRoom(payload.room_id, { last_message: payload.content, last_at: new Date().toISOString() });
        return;
      }
      refreshDmRooms();
      setToast(`${payload.from}: ${(payload.content || "").slice(0, 40)}`);
    }).on("broadcast", { event: "note-access-request" }, ({ payload }) => {
      pushNotif(
        `${payload.from}님이 "${payload.title}" 노트 접근을 요청했어요`,
        null,
        { type: "access-request", noteId: payload.note_id, fromId: payload.from_id, fromName: payload.from, noteTitle: payload.title },
        "key",
      );
    }).on("broadcast", { event: "note-access-granted" }, ({ payload }) => {
      syncShared();
      setToast(`"${payload.title}" 노트 접근이 허락됐어요`);
      pushNotif(`"${payload.title}" 노트 접근이 허락됐어요`, null, { type: "note", noteId: payload.note_id }, "share");
    }).on("broadcast", { event: "note-access-denied" }, ({ payload }) => {
      setToast(`"${payload.title}" 노트 접근 요청이 거절됐어요`);
    }).on("broadcast", { event: "note-shared" }, ({ payload }) => {
      // 새로고침 없이 사이드바 '공유받은 노트'에 추가하고 🔔 알림에 기록
      syncShared({ [payload.note_id]: payload.from });
    }).on("broadcast", { event: "note-unshared" }, ({ payload }) => {
      setSharedNotes(prev => prev.filter(n => n.id !== payload.note_id));
      setView(v => (v.type === "note" && v.noteId === payload.note_id ? { type: "home" } : v));
    }).subscribe();
    return () => supabase.removeChannel(ch);
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 공유받은 노트: 로그인할 때, 탭으로 돌아올 때, 2분마다 확인 (실시간 신호를 놓쳤을 때 대비)
  useEffect(() => {
    if (!user?.uid) return;
    syncShared();
    const onVisible = () => { if (document.visibilityState === "visible") syncShared(); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(onVisible, 120000);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearInterval(t); };
  }, [user?.uid, syncShared]);

  // 🔔 알림 기록은 새로고침해도 남게 (사람별로 브라우저에 저장)
  useEffect(() => {
    if (!user?.uid) { setNotifications([]); return; }
    try { setNotifications(JSON.parse(localStorage.getItem(`studyrag:notifs:${user.uid}`)) || []); }
    catch { setNotifications([]); }
  }, [user?.uid]);
  useEffect(() => {
    if (!user?.uid) return;
    try { localStorage.setItem(`studyrag:notifs:${user.uid}`, JSON.stringify(notifications.slice(0, 50))); }
    catch { /* 저장 못 해도 동작 */ }
  }, [notifications, user?.uid]);

  // 로그인·로그아웃 때 대화 목록을 새로
  useEffect(() => {
    if (user?.uid) refreshDmRooms(); else resetDmStore();
  }, [user?.uid]);

  // 연속 학습일 로드
  useEffect(() => {
    if (!user?.uid) return;
    apiFetch("/users/streak").then(d => setStreak(d.streak ?? 0)).catch(() => {});
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 공개 노트 URL 비로그인 진입 처리 ────────────────────────────────
  useEffect(() => {
    if (user !== null) { setPublicNote(null); return; } // 로그인 상태면 앱에서 처리
    const h = window.location.hash;
    if (!h.startsWith("#note/")) { setPublicNote(null); return; }
    const id = h.slice(6);
    if (!id) { setPublicNote(null); return; }
    setPublicNote(prev => prev?.id === id && prev.status !== "loading" ? prev : { id, status: "loading", data: null });
    apiFetch(`/notes/${id}`)
      .then(data => setPublicNote({ id, status: data.visibility === "public" ? "ready" : "denied", data }))
      .catch(() => setPublicNote(prev => ({ ...prev, status: "denied" })));
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 해시 라우팅 ──────────────────────────────────────────────────────
  // 뒤로가기/앞으로가기 시 hash 변화를 view에 반영
  useEffect(() => {
    const onPop = () => {
      try { setView(hashToView(window.location.hash)); } catch {}
      const h = window.location.hash;
      if (h === "#login") setPreAuthView("login");
      else if (h === "#landing" || h === "" || h === "#") setPreAuthView("landing");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 비로그인 시 #landing/#login, 로그인 시 view에 맞게 hash 동기화
  useEffect(() => {
    if (user === null) {
      // 공개 노트 URL은 확인이 끝날 때까지, 그리고 공개면 계속 유지
      if (publicNote && publicNote.status !== "denied") return;
      const target = preAuthView === "login" ? "#login" : "#landing";
      if (window.location.hash !== target) window.history.replaceState(null, "", target);
      return;
    }
    if (user === undefined) return;
    const next = viewToHash(view);
    if (window.location.hash !== next) window.history.pushState(null, "", next);
  }, [view, user, preAuthView, publicNote]);

  // hash에 docId만 있고 filename이 없을 때 (북마크·공유 링크 진입) pastDocs에서 채워넣기
  useEffect(() => {
    if (view.type !== "doc" || view.filename) return;
    const doc = pastDocs.find(d => d.doc_id === view.docId)
      || Object.values(groupData).flatMap(g => g?.docs || []).find(d => d.doc_id === view.docId);
    if (doc) setView(v => v.type === "doc" && v.docId === doc.doc_id ? { ...v, filename: doc.filename } : v);
  }, [view, pastDocs, groupData]);

  // 알림창: 열 때가 아니라 닫을 때 읽음 처리 — 열자마자 지우면 어떤 게 새 알림인지 안 보인다
  const closeNotif = () => {
    setNotifOpen(false);
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
  };

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      if (u) {
        setUserId(u.uid);
        setServerWaking(false);
        apiFetch("/documents/")
          .then(data => { setPastDocs(dedupDocs(data)); setServerWaking(false); })
          .catch(err => {
            if (err.isColdStart) setServerWaking(true);
          });
        apiFetch("/notes/").then(setNotes).catch(() => {});
        apiFetch("/quiz/due-count").then(d => setReviewDue(d.count || 0)).catch(() => {});
        apiFetch("/learn/cards/summary").then(d => { setCardsDue(d.due || 0); setCardDecks(d.groups || []); }).catch(() => {});
        apiFetch("/users/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: u.email, display_name: u.displayName || u.email?.split("@")[0] }),
        }).catch(() => {});
        loadGroups();
      } else {
        setUserId(null);
        setPastDocs([]);
        setNotes([]);
        setGroups([]);
        setGroupData({});
        setView({ type: "home" });
        setServerWaking(false);
      }
    });
  }, [loadGroups]);

  const docId = view.type === "doc" ? view.docId : null;
  const groupId = view.groupId || null;

  // 이미지 자료는 글자 인식이 끝나야 요약·Q&A를 쓸 수 있다 — 상태를 확인하고 처리 중이면 3초마다 다시 본다
  const [docStatus, setDocStatus] = useState(null); // { docId, status, error, progress }
  const docStatusValue = docStatus?.docId === docId ? docStatus.status : null;
  const docProgress = docStatus?.docId === docId ? (docStatus.progress ?? 0) : 0;
  useEffect(() => {
    if (!docId) return;
    let alive = true;
    let timer;
    const check = async () => {
      try {
        const s = await apiFetch(`/documents/upload-status/${docId}`);
        if (!alive) return;
        setDocStatus({ docId, status: s.status, error: s.error, progress: s.progress ?? 0 });
        if (s.status === "processing") timer = setTimeout(check, 3000);
        else {
          const patchStatus = d => d.doc_id === docId ? { ...d, status: s.status } : d;
          setPastDocs(prev => prev.map(patchStatus));
          setGroupData(g => Object.fromEntries(Object.entries(g).map(([k, v]) =>
            [k, v?.docs ? { ...v, docs: v.docs.map(patchStatus) } : v])));
        }
      } catch {
        if (alive) timer = setTimeout(check, 5000);
      }
    };
    check();
    return () => { alive = false; clearTimeout(timer); };
  }, [docId, docStatusValue === "processing"]); // eslint-disable-line react-hooks/exhaustive-deps

  // 그룹 멤버들에게 내가 지금 보고 있는 페이지를 알린다 (presence)
  useEffect(() => {
    const viewing = view.type === "group" ? "home"
      : view.type === "gnote" ? `note:${view.noteId}`
      : view.type === "doc" && view.groupId ? `doc:${view.docId}` : null;
    groups.forEach(g => setViewing(g.id, g.id === groupId ? viewing : null));
  }, [view, groups, groupId, setViewing]);

  useEffect(() => {
    setWrongCount(0);
  }, [docId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.setAttribute("data-theme", "dark");
    else if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  if (user === undefined) return null;
  if (!user) {
    // 공개 노트 확인 중 → 잠깐 빈 화면
    if (publicNote?.status === "loading") return null;
    // 공개 노트 → 로그인 없이 바로 표시
    if (publicNote?.status === "ready") {
      return <PublicNotePage note={publicNote.data} onLogin={() => {
        setPublicNote(null);
        setPreAuthView("login");
        window.history.pushState(null, "", "#login");
      }} />;
    }
    if (preAuthView === "login") return <LoginPage />;
    return <LandingPage onStart={() => {
      setPreAuthView("login");
      window.history.pushState(null, "", "#login");
    }} />;
  }

  async function handleDeleteDoc(doc_id) {
    try {
      await apiFetch(`/documents/${doc_id}`, { method: "DELETE" });
      setPastDocs(prev => prev.filter(d => d.doc_id !== doc_id));
      if (docId === doc_id) setView({ type: "home" });
    } catch (err) { setError(err.message); }
  }

  async function handleFilesAccepted(files) {
    if (!files[0]) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", files[0]);
      const data = await apiFetch("/documents/upload", { method: "POST", body: form });
      setServerWaking(false);
      setPastDocs(prev => [{ doc_id: data.doc_id, filename: data.filename, status: data.status, created_at: new Date().toISOString() }, ...prev]);
      setPreJoined(null);
      setView({ type: "doc", docId: data.doc_id, filename: data.filename, tab: "summary" });
    } catch (err) {
      if (err.isColdStart) setServerWaking(true);
      else setError(err.message);
    }
    finally { setUploading(false); }
  }

  async function retryRecognition() {
    try {
      await apiFetch(`/documents/${docId}/reprocess`, { method: "POST" });
      setDocStatus({ docId, status: "processing", error: null, progress: 0 });
    } catch (err) { setError(err.message); }
  }

  async function cancelAnalysis() {
    try {
      await apiFetch(`/documents/${docId}/cancel`, { method: "POST" });
      setDocStatus({ docId, status: "failed", error: "분석이 취소됐습니다.", progress: 0 });
    } catch (err) { setError(err.message); }
  }

  // 플래너 할 일에 연결된 자료·노트 열기
  function openPlannerLink(t) {
    const gid = view.type === "planner" ? view.groupId : null;
    if (t.link_type === "doc") {
      if (gid) setView({ type: "doc", docId: t.link_id, filename: t.link_label, groupId: gid, tab: "summary" });
      else selectDoc(t.link_id, t.link_label, "summary");
    } else if (t.link_type === "gnote") {
      setView({ type: "gnote", groupId: gid || Object.keys(groupData).find(g => groupData[g]?.notes?.some(n => n.id === t.link_id)), noteId: t.link_id });
    } else if (t.link_type === "note") {
      setView({ type: "note", noteId: t.link_id });
    }
  }

  // 자료 열기 (개인·그룹 어디 있든) — 플래시카드·시험 대비·약한 개념에서 쓴다
  function openAnyDoc(docId, filename, tab = "summary", gid) {
    const g = gid || Object.keys(groupData).find(k => groupData[k]?.docs?.some(d => d.doc_id === docId));
    if (g && !pastDocs.some(d => d.doc_id === docId)) setView({ type: "doc", docId, filename, groupId: g, tab });
    else selectDoc(docId, filename, tab);
  }

  const todayStr = new Date().toLocaleDateString("sv-SE");
  const cardsBadge = view.type === "cards" ? 0
    : (!cardsSeen || cardsSeen.date !== todayStr || cardsDue > cardsSeen.count) ? cardsDue : 0;

  const refreshCardsDue = () => apiFetch("/learn/cards/summary")
    .then(d => { setCardsDue(d.due || 0); setCardDecks(d.groups || []); }).catch(() => {});

  // 사이드바에서 플래시카드 모음 통째로 삭제
  async function deleteDeck(g) {
    const qs = g.kind === "doc" ? `doc_id=${g.id}` : g.kind === "note" ? `note_id=${g.id}` : "etc=1";
    try {
      const r = await apiFetch(`/learn/cards?${qs}`, { method: "DELETE" });
      setToast(`“${g.label.replace(/\.pdf$/i, "")}” 카드 ${r.deleted}장을 지웠어요`);
      setCardDecks(ds => ds.filter(d => d.key !== g.key));
      refreshCardsDue();
      setCardsKey(k => k + 1);
      setLearnKey(k => k + 1);
      if (view.type === "cards" && view.deck === g.key) setView({ type: "cards" });
    } catch (err) { setError(err.message); }
  }

  // 개념 하나만 / 고른 글로만 퀴즈 → 퀴즈 탭에서 바로 풀기
  async function quizFrom(docId, { concept, text } = {}) {
    setToast("AI가 퀴즈를 만드는 중이에요… (최대 1분)");
    try {
      const s = await generateQuiz({ doc_id: docId, n: 5, focus_concept: concept || null, context_text: text || null });
      setQuizInitialSession(s);
      if (view.type === "doc" && view.docId === docId) setView(v => ({ ...v, tab: "quiz" }));
      else {
        const name = pastDocs.find(d => d.doc_id === docId)?.filename
          || Object.values(groupData).flatMap(g => g?.docs || []).find(d => d.doc_id === docId)?.filename;
        openAnyDoc(docId, name, "quiz");
      }
      setToast("");
    } catch (err) { setError(err.message); setToast(""); }
  }

  async function cardsFrom(body) {
    const made = await generateCards(body);
    setToast(`플래시카드 ${made.length}장을 만들었어요`);
    setLearnKey(k => k + 1);
    refreshCardsDue();
    return made.length;
  }

  const sourceActions = (docId) => ({
    saveNote: (title, md) => createNote({ title, content: md, doc_id: docId }, false).then(n => n && setToast("노트로 저장했어요")),
    makeCards: (text, page) => cardsFrom({ doc_id: docId, text, page, n: 6 }),
    makeQuiz: (text) => quizFrom(docId, { text }),
  });

  function selectDoc(id, name, targetTab = "summary") {
    setPreJoined(null);
    setView({ type: "doc", docId: id, filename: name, tab: targetTab });
  }

  // 그룹 홈의 "참가하기" — 방 코드 입력 없이 그룹 표시 이름으로 바로 들어간다
  async function joinGroupQuiz(gid, info) {
    const nickname = groupData[gid]?.detail?.members?.find(m => m.user_id === user.uid)?.display_name || displayName;
    try {
      const res = await apiFetch("/rooms/join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: info.code, nickname }),
      });
      setPreJoined({ room_id: res.room_id, nickname, doc_id: res.doc_id });
      setView({ type: "doc", docId: res.doc_id, filename: info.filename, groupId: gid, tab: "room" });
    } catch (err) {
      setGroupQuiz(q => { const n = { ...q }; delete n[gid]; return n; });
      setError(err.message);
    }
  }

  async function createNote({ title = "", content = "", doc_id = null, parent_id = null } = {}, open = true) {
    try {
      const n = await apiFetch("/notes/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, doc_id, parent_id, icon: null }),
      });
      setNotes(prev => [n, ...prev]);
      if (open) setView({ type: "note", noteId: n.id });
      return n;
    } catch (err) { setError(err.message); }
  }

  async function createGroup(name, displayName, visibility = "code", level = null, sublevel = null, subject = null) {
    const g = await apiFetch("/groups/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, display_name: displayName, visibility, level, sublevel, subject }),
    });
    setGroups(prev => [...prev, g]);
    await loadGroup(g.id);
    setView({ type: "group", groupId: g.id });
  }

  async function askMultiDocs(docIds, question) {
    return apiFetch("/qa/multi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_ids: docIds, question }),
    });
  }

  async function joinPublicGroup(groupId, displayName) {
    const g = await apiFetch("/groups/join-public", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, display_name: displayName }),
    });
    setGroups(prev => prev.find(x => x.id === g.id) ? prev : [...prev, g]);
    await loadGroup(g.id);
    setView({ type: "group", groupId: g.id });
    setTimeout(() => notify(g.id, "member-joined"), 1500);
  }

  async function joinGroup(code, displayName) {
    const g = await apiFetch("/groups/join", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, display_name: displayName }),
    });
    setGroups(prev => prev.some(x => x.id === g.id) ? prev : [...prev, g]);
    await loadGroup(g.id);
    setView({ type: "group", groupId: g.id });
    // 새 그룹 채널 구독이 붙은 뒤에 알리도록 약간 늦춘다
    setTimeout(() => notify(g.id, "member-joined"), 1500);
  }

  async function leaveGroup(id) {
    try {
      const group = groups.find(g => g.id === id);
      const url = group?.my_role === "owner" ? `/groups/${id}` : `/groups/${id}/members/me`;
      await apiFetch(url, { method: "DELETE" });
      setGroups(prev => prev.filter(g => g.id !== id));
      setGroupData(d => { const n = { ...d }; delete n[id]; return n; });
      setView({ type: "home" });
    } catch (err) { setError(err.message); }
  }

  async function uploadToGroup(id, file) {
    setGroupUploading(id);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const d = await apiFetch(`/groups/${id}/documents`, { method: "POST", body: form });
      await loadGroup(id);
      notify(id, "doc-added", { filename: d.filename, doc_id: d.doc_id });
      setToast(`"${d.filename}" 자료를 그룹에 공유했어요`);
    } catch (err) {
      if (err.isColdStart) setServerWaking(true);
      else setError(err.message);
    } finally { setGroupUploading(null); }
  }

  async function deleteGroupDoc(id, d) {
    try {
      await apiFetch(`/documents/${d.doc_id}`, { method: "DELETE" });
      await loadGroup(id);
      notify(id, "doc-removed", { filename: d.filename });
    } catch (err) { setError(err.message); }
  }

  async function createGroupNote(id, parent_id = null, open = true) {
    try {
      const n = await apiFetch(`/groups/${id}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", parent_id }),
      });
      setGroupData(d => ({ ...d, [id]: { ...d[id], notes: [n, ...(d[id]?.notes || [])] } }));
      notify(id, "note-added", { note_id: n.id });
      if (open) setView({ type: "gnote", groupId: id, noteId: n.id });
      return n;
    } catch (err) { setError(err.message); }
  }

  // 사이드바 노트 ⋯ 메뉴: 하위 페이지·이름 바꾸기·즐겨찾기·복제·옮기기·삭제
  async function noteAction(kind, n, extra) {
    const gid = n.group_id || null;
    if (kind === "add-child") return gid ? createGroupNote(gid, n.id) : createNote({ parent_id: n.id });
    const patch = (fields) => apiFetch(`/notes/${n.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    const keepMeta = (saved) => {   // 목록 순서는 그대로 두고 내용만 바꾼다
      const { ok: _ok, content: _c, ...meta } = saved;
      setNotes(prev => prev.map(x => (x.id === n.id ? { ...x, ...meta } : x)));
    };
    try {
      if (kind === "rename") {
        const saved = await patch({ title: extra });
        if (!gid) keepMeta(saved);
        // 열려 있는 에디터 제목도 바로 바꾼다 (제목은 에디터의 공동 문서에 있음)
        window.dispatchEvent(new CustomEvent("studyrag:note-title", { detail: { id: n.id, title: extra } }));
      } else if (kind === "pin") {
        keepMeta(await patch({ pinned: !n.pinned }));
      } else if (kind === "move") {
        const saved = await patch({ parent_id: extra });
        if (!gid) keepMeta(saved);
        setToast(extra ? "페이지를 옮겼어요" : "맨 위로 옮겼어요");
      } else if (kind === "duplicate") {
        const d = await apiFetch(`/notes/${n.id}/duplicate`, { method: "POST" });
        if (!gid) setNotes(prev => [d, ...prev]);
        setView(gid ? { type: "gnote", groupId: gid, noteId: d.id } : { type: "note", noteId: d.id });
      } else if (kind === "delete") {
        const r = await apiFetch(`/notes/${n.id}`, { method: "DELETE" });
        const gone = new Set(r?.deleted || [n.id]);
        if (!gid) setNotes(prev => prev.filter(x => !gone.has(x.id)));
        if ((view.type === "note" || view.type === "gnote") && gone.has(view.noteId)) {
          setView(gid ? { type: "group", groupId: gid } : { type: "home" });
        }
        setToast(gone.size > 1 ? `노트와 하위 페이지 ${gone.size - 1}개를 삭제했어요` : "노트를 삭제했어요");
      }
      if (gid) { await loadGroup(gid); notify(gid, "notes-changed"); }
    } catch (err) { setError(err.message); }
  }

  async function saveToNote(title, content) {
    const n = await createNote({ title, content, doc_id: docId }, false);
    if (n) setToast(`"${title.slice(0, 24)}" 노트로 저장했어요`);
  }

  const displayName = user.displayName || user.email?.split("@")[0] || "";
  const group = groupId ? groupData[groupId] : null;
  const groupDoc = docId && groupId ? group?.docs?.find(d => d.doc_id === docId) : null;
  const currentDoc = docId ? (groupDoc || pastDocs.find(d => d.doc_id === docId) || { doc_id: docId, filename: view.filename }) : null;
  const groupNote = view.type === "gnote" ? group?.notes?.find(n => n.id === view.noteId) : null;
  const currentNote = view.type === "note"
    ? notes.find(n => n.id === view.noteId) || sharedNotes.find(n => n.id === view.noteId) : null;
  const ownNote = view.type === "note" && notes.some(n => n.id === view.noteId);
  const docTabs = tabsFor(!!groupId);
  const currentTab = view.type === "doc" ? (docTabs.find(([k]) => k === view.tab) || docTabs[0]) : null;
  const myGroupName = group?.detail?.members?.find(m => m.user_id === user.uid)?.display_name || displayName;
  const docNotes = docId ? notes.filter(n => n.doc_id === docId) : [];
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 6 ? "늦은 밤이에요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
  })();

  // breadcrumb
  const groupCrumb = group ? [["", group.detail.name]] : [];
  const crumbs = view.type === "home" ? [["", "홈"]]
    : view.type === "stats" ? [["", "학습 통계"]]
    : view.type === "cards" ? [["", "플래시카드"]]
    : view.type === "exam" ? [["", "시험 대비", view.prepId ? { type: "exam" } : undefined], ...(view.prepId ? [["", "상세"]] : [])]
    : view.type === "planner" ? (view.groupId ? [...groupCrumb, ["", "스터디 플래너"]] : [["", "개인 플래너"]])
    : view.type === "settings" ? [["", "설정"]]
    : view.type === "group-start" ? [["", "그룹 스터디"]]
    : view.type === "group" ? groupCrumb
    : view.type === "gnote" ? [
        ...groupCrumb.map(c => [...c, { type: "group", groupId }]),
        ...ancestorsOf(view.noteId, group?.notes || []).map(a => [a.icon || "", a.title || "제목 없음", { type: "gnote", groupId, noteId: a.id }]),
        [groupNote?.icon || "", groupNote?.title || "제목 없음"],
      ]
    : view.type === "doc" ? [...(groupId ? groupCrumb : []), ["", currentDoc?.filename?.replace(/\.pdf$/i, "")], [currentTab?.[3], currentTab?.[1]]]
    : (() => {
        const linked = currentNote?.doc_id && pastDocs.find(d => d.doc_id === currentNote.doc_id);
        return [
          ...(linked ? [["", linked.filename.replace(/\.pdf$/i, ""), { type: "doc", docId: linked.doc_id, filename: linked.filename, tab: "summary" }]] : [["", "내 노트"]]),
          ...ancestorsOf(view.noteId, notes).map(a => [a.icon || "", a.title || "제목 없음", { type: "note", noteId: a.id }]),
          [currentNote?.icon || "", currentNote?.title || "제목 없음"],
        ];
      })();

  return (
    <div className="app-shell">
      <Sidebar
        user={user} view={view} onNavigate={setView}
        pastDocs={pastDocs} notes={notes} wrongCount={wrongCount} reviewDue={reviewDue}
        onNewNote={(doc_id) => createNote({ doc_id: doc_id || null })}
        onUpload={handleFilesAccepted} uploading={uploading}
        onLogout={logout}
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        groups={groups} groupData={groupData} online={online}
        onNewGroupNote={createGroupNote}
        sharedNotes={sharedNotes}
        onOpenSharedNote={(noteId) => setView({ type: "note", noteId })}
        dmUnread={dmUnread}
        streak={streak}
        onNoteAction={noteAction}
        cardsDue={cardsBadge}
        cardDecks={cardDecks}
        onDeleteDeck={deleteDeck}
        theme={theme} onToggleTheme={() => setTheme(t => t === "dark" ? "auto" : "dark")}
      />

      {source && (
        <SourceViewer docId={source.docId} page={source.page} quote={source.quote} filename={source.filename}
          onClose={() => setSource(null)} actions={sourceActions(source.docId)} />
      )}

      <div className="main">
        <div className="topbar">
          <button className="topbar-menu" onClick={() => setSidebarOpen(true)} aria-label="메뉴 열기">
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <button className="topbar-collapse" onClick={() => setSidebarCollapsed(c => !c)} aria-label="사이드바 접기">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {sidebarCollapsed
                ? <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
            </svg>
          </button>
          <nav className="breadcrumb" aria-label="현재 위치">
            {crumbs.map(([icon, label, to], i) => (
              <span key={i} className="crumb">
                {i > 0 && <span className="crumb-sep">/</span>}
                {to ? (
                  <button className="crumb-link" onClick={() => setView(to)}>
                    <span className="crumb-icon">{icon}</span>
                    <span className="crumb-label">{label}</span>
                  </button>
                ) : (
                  <>
                    <span className="crumb-icon">{icon}</span>
                    <span className="crumb-label">{label}</span>
                  </>
                )}
              </span>
            ))}
          </nav>
          <div className="topbar-right">
            <div className="notif-wrap">
              <button className="notif-bell" aria-label="알림"
                onClick={() => (notifOpen ? closeNotif() : setNotifOpen(true))}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {notifications.some(n => n.unread) && (
                  <span className="notif-dot">{notifications.filter(n => n.unread).length}</span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="notif-backdrop" onClick={closeNotif} />
                  <div className="notif-panel">
                    <div className="notif-panel-head">
                      <span>알림</span>
                      {notifications.length > 0 && (
                        <button className="btn-ghost notif-clear" onClick={() => setNotifications([])}>모두 지우기</button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <p className="notif-empty">새 알림이 없어요</p>
                    ) : notifications.map(n => (
                      <div key={n.id} className={`notif-item ${n.unread ? "notif-item--unread" : ""} ${n.target?.type === "access-request" ? "notif-item--action" : ""}`}
                        onClick={() => {
                          if (n.target?.type === "access-request") return;
                          const t = n.target || (n.groupId && { type: "group", groupId: n.groupId });
                          if (t?.type === "note") {
                            if (sharedNotes.some(x => x.id === t.noteId) || notes.some(x => x.id === t.noteId)) setView(t);
                            else setToast("공유가 해제된 노트예요");
                            closeNotif();
                            return;
                          }
                          const gd = t && groupData[t.groupId];
                          const exists = !t || !gd ? !!gd
                            : t.type === "doc" ? gd.docs?.some(d => d.doc_id === t.docId)
                            : t.type === "gnote" ? gd.notes?.some(x => x.id === t.noteId) : true;
                          if (t && gd) setView(exists ? t : { type: "group", groupId: t.groupId });
                          closeNotif();
                        }}>
                        <span className="notif-icon-wrap" aria-hidden="true">
                          {n.icon === "key" && <KeyIcon size="14px" />}
                          {n.icon === "share" && <ShareIcon size="14px" />}
                          {n.icon === "quiz" && <SparkleIcon size="14px" />}
                          {n.icon === "group" && <UsersIcon size="14px" />}
                          {n.icon === "dm" && <MessageIcon size="14px" />}
                          {!n.icon && <NoteIcon size="14px" />}
                        </span>
                        <span className="notif-text">{n.text}</span>
                        <span className="notif-time">{timeAgo(n.time)}</span>
                        {n.target?.type === "access-request" && (
                          <div className="notif-actions" onClick={e => e.stopPropagation()}>
                            {!n.action && <>
                              <button className="notif-action-btn notif-action-btn--approve"
                                onClick={() => approveAccess(n)}>허락</button>
                              <button className="notif-action-btn notif-action-btn--deny"
                                onClick={() => denyAccess(n)}>거절</button>
                            </>}
                            {n.action === "approving" && <span className="notif-action-done">처리 중...</span>}
                            {n.action === "approved" && <span className="notif-action-done notif-action-done--ok">허락됨</span>}
                            {n.action === "denied" && <span className="notif-action-done notif-action-done--no">거절됨</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {view.type === "chat" && (
          <ChatApp
            me={user}
            groups={groups}
            groupDetails={Object.fromEntries(
              Object.entries(groupData).filter(([, v]) => v?.detail).map(([k, v]) => [k, v.detail])
            )}
          />
        )}

        <div className={`page ${view.type === "planner" ? "page--wide" : ""}`} style={view.type === "chat" ? { display: "none" } : undefined}>
          {serverWaking && (
            <div className="callout callout--amber">
              <div className="spinner spinner-sm" />
              <span>서버를 시작하는 중입니다. 최대 1분 소요돼요 — 자동으로 연결됩니다.</span>
            </div>
          )}
          {error && (
            <div className="error-banner">
              
              <span style={{ flex: 1 }}>{error}</span>
              <button className="btn-ghost" onClick={() => setError("")}>닫기</button>
            </div>
          )}

          {view.type === "home" && (
            <DashboardHome
              onFileAccepted={handleFilesAccepted}
              onSelectDoc={(id, name) => selectDoc(id, name, "summary")}
              onSelectDocTab={selectDoc}
              onDeleteDoc={handleDeleteDoc}
              pastDocs={pastDocs}
              uploading={uploading}
              reviewDue={reviewDue}
              streak={streak}
              onAskMulti={askMultiDocs}
              onOpenPlanner={() => setView({ type: "planner" })}
              onPastDocsChange={() => apiFetch("/documents/").then(d => setPastDocs(dedupDocs(d))).catch(() => {})}
              notes={notes}
              onOpenNote={(noteId) => setView({ type: "note", noteId })}
              onCreateNote={() => createNote()}
            />
          )}

          {view.type === "planner" && (
            <Suspense fallback={<div className="loading-wrap"><div className="spinner" /></div>}>
              <PlannerPage
                key={view.groupId || "mine"}
                user={user}
                groupId={view.groupId || null}
                groupName={view.groupId ? group?.detail?.name : null}
                onOpenLink={openPlannerLink}
              />
            </Suspense>
          )}

          {view.type === "stats" && (
            <>
              <h1 className="page-title">학습 통계</h1>
              <WeakConcepts onOpenDoc={(id, name, gid) => openAnyDoc(id, name, "mastery", gid)} />
              <StatsSection />
            </>
          )}

          {view.type === "cards" && (
            <Suspense fallback={<div className="loading-wrap"><div className="spinner" /></div>}>
              <FlashcardsPage
                key={cardsKey}
                openDeck={view.deck || null}
                onOpenDoc={(id, name) => openAnyDoc(id, name, "cards")}
                onOpenNote={(noteId) => setView({ type: "note", noteId })}
                onOpenSource={(docId, page) => setSource({ docId, page })}
                onChanged={refreshCardsDue}
              />
            </Suspense>
          )}

          {view.type === "exam" && (
            <Suspense fallback={<div className="loading-wrap"><div className="spinner" /></div>}>
              <ExamPage
                prepId={view.prepId || null}
                docs={[
                  ...pastDocs.filter(d => (d.status || "done") === "done"),
                  ...groups.flatMap(g => (groupData[g.id]?.docs || []).map(d => ({ ...d, group: g.name }))),
                ]}
                onOpenPrep={(id) => setView(id ? { type: "exam", prepId: id } : { type: "exam" })}
                onOpenDoc={(id, name, tab) => openAnyDoc(id, name, tab)}
                onOpenSource={(docId, page) => setSource({ docId, page })}
                onSaveNote={(title, md) => createNote({ title, content: md }, false).then(n => n && setToast("노트로 저장했어요"))}
              />
            </Suspense>
          )}

          {view.type === "settings" && (
            <>
              <h1 className="page-title">설정</h1>
              <SettingsPage
                user={user}
                onUserRefresh={() => setUser({ ...auth.currentUser })}
              />
            </>
          )}

          {view.type === "group-start" && (
            <GroupStart me={user} onCreate={createGroup} onJoin={joinGroup} onJoinPublic={joinPublicGroup} />
          )}

          {view.type === "group" && (group ? (
            <GroupHome
              key={groupId}
              group={group.detail} docs={group.docs} notes={group.notes}
              online={online[groupId]} me={user} realtime={realtime}
              uploading={groupUploading === groupId}
              onUpload={(file) => uploadToGroup(groupId, file)}
              onOpenDoc={(d) => setView({ type: "doc", docId: d.doc_id, filename: d.filename, groupId, tab: "summary" })}
              onOpenNote={(n) => setView({ type: "gnote", groupId, noteId: n.id })}
              onNewNote={() => createGroupNote(groupId)}
              onDeleteDoc={(d) => deleteGroupDoc(groupId, d)}
              onLeave={() => leaveGroup(groupId)}
              quiz={groupQuiz[groupId]}
              onJoinQuiz={(info) => joinGroupQuiz(groupId, info)}
              onReload={() => loadGroup(groupId)}
              onOpenPlanner={() => setView({ type: "planner", groupId })}
              onToast={setToast}
            />
          ) : <div className="loading-wrap"><div className="spinner" /></div>)}

          {view.type === "gnote" && (
            <Suspense fallback={<div className="loading-wrap"><div className="spinner" /></div>}>
            <GroupNotePage
              key={view.noteId}
              noteId={view.noteId}
              user={user}
              group={group?.detail}
              pages={{
                // 본문에서 "/노트" → 이 노트 안에 하위 노트
                create: () => createGroupNote(groupId, view.noteId, false),
                open: (id) => setView({ type: "gnote", groupId, noteId: id }),
                lookup: (id) => (group?.notes ? group.notes.find(n => n.id === id) || null : undefined),
              }}
              onSaved={() => loadGroup(groupId)}
              onDeleted={() => { loadGroup(groupId); notify(groupId, "notes-changed"); setView({ type: "group", groupId }); }}
            />
            </Suspense>
          )}

          {view.type === "note" && (
            <Suspense fallback={<div className="loading-wrap"><div className="spinner" /></div>}>
            <NotePage
              key={view.noteId}
              noteId={view.noteId}
              user={user}
              pastDocs={pastDocs}
              onChanged={(saved) => {
                // 내 노트 목록만 갱신 (공유받은 노트가 내 목록에 끼어들지 않게)
                if (saved?.id && saved.user_id === user.uid) {
                  const { ok: _ok, content: _c, ...meta } = saved;
                  setNotes(prev => [meta, ...prev.filter(n => n.id !== saved.id)]);
                }
              }}
              onDeleted={(id, ids) => { const gone = new Set(ids || [id]); setNotes(prev => prev.filter(n => !gone.has(n.id))); setView({ type: "home" }); }}
              pages={{
                create: () => createNote({ parent_id: view.noteId }, false),
                open: (id) => setView({ type: "note", noteId: id }),
                // 내 노트 안의 노트가 목록에 없으면 삭제된 것, 공유받은 노트면 모름(undefined)
                lookup: (id) => notes.find(n => n.id === id) || sharedNotes.find(n => n.id === id) || (ownNote ? null : undefined),
              }}
              onOpenDoc={(id, name) => selectDoc(id, name, "summary")}
              onMakeCards={() => cardsFrom({ note_id: view.noteId, n: 8 })}
              onOpenCards={() => setView({ type: "cards" })}
            />
            </Suspense>
          )}

          {view.type === "doc" && (
            <>
              <div className="page-icon"><DocIcon size="1.4em" /></div>
              <h1 className="page-title page-title--doc" title={currentDoc?.filename}>
                {currentDoc?.filename?.replace(/\.pdf$/i, "")}
              </h1>

              {groupDoc && (
                <p className="doc-uploader">
                  {group.detail.name} · <strong>{groupDoc.uploader_name}</strong>님이 {groupTimeAgo(groupDoc.created_at)} 올림
                </p>
              )}
              <div className="doc-meta-row">
                {docNotes.map(n => (
                  <button key={n.id} className="doc-note-chip" onClick={() => setView({ type: "note", noteId: n.id })}>
                    {renderNoteIcon(n.icon, "0.9em") || <NoteIcon size="0.9em" />} {n.title || "제목 없음"}
                  </button>
                ))}
                <button className="doc-note-chip doc-note-chip--add" onClick={() => createNote({ doc_id: docId })}>
                  + 노트 추가
                </button>
                <a className="doc-note-chip"
                  href={`${import.meta.env.VITE_API_BASE_URL ?? ""}/documents/${docId}/file`}
                  download={currentDoc?.filename}
                  target="_blank" rel="noreferrer">
                  ⬇ 원본 다운로드
                </a>
              </div>

              <div className="tabs" role="tablist" aria-label="학습 메뉴">
                {docTabs.map(([key, label, desc, icon]) => (
                  <button key={key} className={`tab ${currentTab?.[0] === key ? "active" : ""}`}
                    role="tab" aria-selected={currentTab?.[0] === key} aria-controls={`panel-${key}`}
                    id={`tab-${key}`} title={desc}
                    onClick={() => setView(v => ({ ...v, tab: key }))}>
                    <span className="tab-icon">{icon}</span>
                    {label}
                    {key === "wrong" && wrongCount > 0 && <span className="tab-count">{wrongCount}</span>}
                  </button>
                ))}
              </div>
              <p className="tab-desc" aria-live="polite">
                {currentTab?.[2]}
                {groupId && (view.tab === "qa" || view.tab === "tutor") && " · 그룹 자료지만 대화 기록은 나만 볼 수 있어요"}
              </p>

              {docStatusValue === "processing" && (
                <div className="callout" style={{ flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="spinner spinner-sm" />
                    <span style={{ flex: 1 }}>이미지에서 글자를 인식하는 중이에요. 무료 AI가 붐비면 1~2분 걸릴 수 있어요.</span>
                    <button className="btn-ghost btn-sm" onClick={cancelAnalysis}>취소</button>
                  </div>
                  {docProgress > 0 && (
                    <div style={{ width: "100%", height: 6, background: "var(--border)", borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${docProgress}%`, background: "var(--accent)", borderRadius: 3, transition: "width .5s" }} />
                    </div>
                  )}
                </div>
              )}
              {docStatusValue === "failed" && (
                <div className="error-banner">
                  
                  <span style={{ flex: 1 }}>
                    이미지 인식에 실패했어요. 무료 AI 모델이 잠시 붐비는 경우가 많아요 — 잠시 후 다시 시도해주세요.
                    {docStatus?.error && <><br /><small style={{ opacity: .75 }}>{docStatus.error}</small></>}
                  </span>
                  <button className="btn-primary" onClick={retryRecognition}>다시 시도</button>
                </div>
              )}

              {(docStatusValue === "done" || docStatusValue === null) && <div key={docId}>
                {[
                  ["summary", <SummarySection key="summary" docId={docId} onSaveNote={saveToNote}
                                onOpenSource={(page, quote) => setSource({ docId, page, quote, filename: currentDoc?.filename })} />],
                  ["qa",      <QASection key="qa" docId={docId} onSaveNote={saveToNote}
                                onOpenSource={(page, quote) => setSource({ docId, page, quote, filename: currentDoc?.filename })} />],
                  ["tutor",   <TutorSection key="tutor" docId={docId} />],
                  ["quiz",    <QuizSection key="quiz" docId={docId}
                                initialSession={quizInitialSession}
                                onClearInitial={() => setQuizInitialSession(null)}
                                onGoToWrong={() => { setView(v => ({ ...v, tab: "wrong" })); setWrongRefreshKey(k => k + 1); }} />],
                  ["wrong",   <WrongAnswerBook key="wrong" docId={docId} refreshKey={wrongRefreshKey}
                                onCountLoaded={setWrongCount}
                                onGoToQuiz={() => setView(v => ({ ...v, tab: "quiz" }))}
                                onRetryWrongs={async () => {
                                  const data = await apiFetch(`/quiz/retry-wrongs?doc_id=${docId}`, { method: "POST" });
                                  setQuizInitialSession(data);
                                  setView(v => ({ ...v, tab: "quiz" }));
                                }} />],
                  ["mastery", <MasteryMap key="mastery" docId={docId} filename={currentDoc?.filename}
                                refreshKey={learnKey + wrongRefreshKey + (view.tab === "mastery" ? 1 : 0)}
                                onQuiz={(concept) => quizFrom(docId, { concept })}
                                onCards={(concept) => cardsFrom({ doc_id: docId, concept, n: 5 })}
                                onGoQuiz={() => setView(v => ({ ...v, tab: "quiz" }))}
                                onToast={setToast} />],
                  ["cards",   <CardDeck key="cards" docId={docId} refreshKey={learnKey}
                                onToast={(m) => { setToast(m); refreshCardsDue(); }} onChanged={refreshCardsDue}
                                onOpenSource={(id, page) => setSource({ docId: id, page, filename: currentDoc?.filename })} />],
                  ...(groupId ? [["room", <StudyRoomSection key="room" docId={docId} userId={user?.uid}
                    groupId={groupId}
                    preJoined={preJoined?.doc_id === docId ? preJoined : null}
                    defaultNickname={myGroupName}
                    onRoomCreated={({ room_id, code }) => notify(groupId, "quiz-room", {
                      room_id, code, doc_id: docId, filename: currentDoc?.filename || "",
                    })} />]] : []),
                ].map(([key, el]) => (
                  <div key={key} className="tab-panel" role="tabpanel" id={`panel-${key}`}
                    aria-labelledby={`tab-${key}`}
                    style={{ display: currentTab?.[0] === key ? "" : "none" }}>
                    {el}
                  </div>
                ))}
              </div>}
            </>
          )}
        </div>
      </div>

      {/* 오른쪽 아래 작은 채팅창 — 채팅 페이지에서는 숨김 */}
      {view.type !== "chat" && (
        <ChatWidget
          me={user}
          groups={groups}
          groupDetails={Object.fromEntries(
            Object.entries(groupData).filter(([, v]) => v?.detail).map(([k, v]) => [k, v.detail])
          )}
          unread={dmUnread}
          onExpand={() => setView({ type: "chat" })}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
