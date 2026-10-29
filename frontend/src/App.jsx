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
import StatsSection from "./components/StatsSection";
import SettingsPage from "./components/SettingsPage";
import LoginPage from "./components/LoginPage";
import Sidebar, { tabsFor } from "./components/Sidebar";
import GroupHome, { GroupStart, timeAgo as groupTimeAgo } from "./components/GroupHome";
import ChatApp from "./components/ChatApp";
import ChatWidget from "./components/chat/ChatWidget";
import { useDmRooms, refreshDmRooms, resetDmStore, isRoomOpen, touchDmRoom, badgeCount } from "./realtime/dmStore";
import { useGroupChannels } from "./realtime/useGroupChannels";
import { supabase } from "./supabase";
import "./App.css";

// 블록 에디터(BlockNote)는 무거워서 공동 노트를 열 때만 불러온다
const GroupNotePage = lazy(() => import("./components/GroupNotePage"));
const NotePage = lazy(() => import("./components/NotePage"));
const PlannerPage = lazy(() => import("./components/planner/PlannerPage"));

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
  const [view, setView] = useState({ type: "home" });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pastDocs, setPastDocs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [wrongCount, setWrongCount] = useState(0);
  const [preJoined, setPreJoined] = useState(null);
  const [serverWaking, setServerWaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
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
  const pushNotif = (text, groupId, target) =>
    setNotifications(prev => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text, groupId, target, time: new Date().toISOString(), unread: true,
    }, ...prev].slice(0, 50));

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
          pushNotif(from ? `📝 ${from}님이 "${title}" 노트를 공유했어요` : `📝 새로 공유받은 노트: "${title}"`,
            null, { type: "note", noteId: n.id });
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
    if (ev.event === "doc-added")     msg = `${ev.by_name}님이 "${ev.filename}" 자료를 올렸어요`;
    else if (ev.event === "note-added")   msg = `${ev.by_name}님이 새 공동 노트를 만들었어요`;
    else if (ev.event === "member-joined") msg = `${ev.by_name}님이 그룹에 참가했어요`;
    else if (ev.event === "quiz-room") {
      setGroupQuiz(q => ({ ...q, [groupId]: ev }));
      msg = `${ev.by_name}님이 그룹 퀴즈 방을 열었어요 (코드 ${ev.code})`;
    }
    if (msg) { setToast(msg); pushNotif(msg, groupId, target); }
  }, myGroupNameFor);

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
      setToast(`💬 ${payload.from}: ${(payload.content || "").slice(0, 40)}`);
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

  if (user === undefined) return null;
  if (!user) return <LoginPage />;

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

  async function createNote({ title = "", content = "", doc_id = null } = {}, open = true) {
    try {
      const n = await apiFetch("/notes/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, doc_id, icon: "📝" }),
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

  async function createGroupNote(id) {
    try {
      const n = await apiFetch(`/groups/${id}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      setGroupData(d => ({ ...d, [id]: { ...d[id], notes: [n, ...(d[id]?.notes || [])] } }));
      notify(id, "note-added", { note_id: n.id });
      setView({ type: "gnote", groupId: id, noteId: n.id });
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
  const currentNote = view.type === "note" ? notes.find(n => n.id === view.noteId) : null;
  const docTabs = tabsFor(!!groupId);
  const currentTab = view.type === "doc" ? (docTabs.find(([k]) => k === view.tab) || docTabs[0]) : null;
  const myGroupName = group?.detail?.members?.find(m => m.user_id === user.uid)?.display_name || displayName;
  const docNotes = docId ? notes.filter(n => n.doc_id === docId) : [];
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 6 ? "늦은 밤이에요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
  })();

  // breadcrumb
  const groupCrumb = group ? [["👥", group.detail.name]] : [];
  const crumbs = view.type === "home" ? [["🏠", "홈"]]
    : view.type === "stats" ? [["📊", "학습 통계"]]
    : view.type === "planner" ? (view.groupId ? [...groupCrumb, ["📅", "스터디 플래너"]] : [["📅", "개인 플래너"]])
    : view.type === "settings" ? [["⚙️", "설정"]]
    : view.type === "group-start" ? [["👥", "그룹 스터디"]]
    : view.type === "group" ? groupCrumb
    : view.type === "gnote" ? [...groupCrumb, [groupNote?.icon || "📄", groupNote?.title || "제목 없음"]]
    : view.type === "doc" ? [...(groupId ? groupCrumb : []), ["📄", currentDoc?.filename?.replace(/\.pdf$/i, "")], [currentTab?.[3], currentTab?.[1]]]
    : (() => {
        const linked = currentNote?.doc_id && pastDocs.find(d => d.doc_id === currentNote.doc_id);
        return [
          ...(linked ? [["📄", linked.filename.replace(/\.pdf$/i, "")]] : [["📝", "내 노트"]]),
          [currentNote?.icon || "📝", currentNote?.title || "제목 없음"],
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
        groups={groups} groupData={groupData} online={online}
        onNewGroupNote={createGroupNote}
        sharedNotes={sharedNotes}
        onOpenSharedNote={(noteId) => setView({ type: "note", noteId })}
        dmUnread={dmUnread}
        streak={streak}
      />

      <div className="main">
        <div className="topbar">
          <button className="topbar-menu" onClick={() => setSidebarOpen(true)} aria-label="메뉴 열기">
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <nav className="breadcrumb" aria-label="현재 위치">
            {crumbs.map(([icon, label], i) => (
              <span key={i} className="crumb">
                {i > 0 && <span className="crumb-sep">/</span>}
                <span className="crumb-icon">{icon}</span>
                <span className="crumb-label">{label}</span>
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
                      <div key={n.id} className={`notif-item ${n.unread ? "notif-item--unread" : ""}`}
                        onClick={() => {
                          const t = n.target || (n.groupId && { type: "group", groupId: n.groupId });
                          if (t?.type === "note") {
                            // 공유받은 노트 — 그새 공유가 해제됐으면 열지 않는다
                            if (sharedNotes.some(x => x.id === t.noteId) || notes.some(x => x.id === t.noteId)) setView(t);
                            else setToast("공유가 해제된 노트예요");
                            closeNotif();
                            return;
                          }
                          // 그새 그룹에서 나갔거나 삭제된 자료면 그룹 홈으로
                          const gd = t && groupData[t.groupId];
                          const exists = !t || !gd ? !!gd
                            : t.type === "doc" ? gd.docs?.some(d => d.doc_id === t.docId)
                            : t.type === "gnote" ? gd.notes?.some(x => x.id === t.noteId) : true;
                          if (t && gd) setView(exists ? t : { type: "group", groupId: t.groupId });
                          closeNotif();
                        }}>
                        <span className="notif-text">{n.text}</span>
                        <span className="notif-time">{timeAgo(n.time)}</span>
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
              <span className="error-icon">⚠️</span>
              <span style={{ flex: 1 }}>{error}</span>
              <button className="btn-ghost" onClick={() => setError("")}>닫기</button>
            </div>
          )}

          {view.type === "home" && (
            <>
              <div className="page-icon">🏠</div>
              <h1 className="page-title">{greeting}{displayName ? `, ${displayName}님` : ""}</h1>

              {streak > 0 && (
                <div className="streak-banner">
                  <span className="streak-fire">🔥</span>
                  <span><strong>{streak}일</strong> 연속 학습 중!</span>
                  {streak >= 7 && <span className="streak-badge">주간 달성</span>}
                  {streak >= 30 && <span className="streak-badge streak-badge--gold">월간 달성</span>}
                </div>
              )}

              <DashboardHome
                onFileAccepted={handleFilesAccepted}
                onSelectDoc={(id, name) => selectDoc(id, name, "summary")}
                onSelectDocTab={selectDoc}
                onDeleteDoc={handleDeleteDoc}
                pastDocs={pastDocs}
                uploading={uploading}
                reviewDue={reviewDue}
                onAskMulti={askMultiDocs}
                onPastDocsChange={() => apiFetch("/documents/").then(d => setPastDocs(dedupDocs(d))).catch(() => {})}
                notesSlot={
                  <div className="dash-section">
                    <div className="dash-section-header">
                      <p className="dash-section-title">최근 노트</p>
                      <button className="btn-ghost" onClick={() => createNote()}>+ 새 노트</button>
                    </div>
                    {notes.length === 0 ? (
                      <button className="note-empty" onClick={() => createNote()}>
                        <span>📝</span> 첫 노트를 만들어보세요. 강의 정리, 질문 메모, 시험 대비 요점 무엇이든요.
                      </button>
                    ) : (
                      <div className="note-gallery">
                        {notes.slice(0, 6).map(n => (
                          <button key={n.id} className="note-card" onClick={() => setView({ type: "note", noteId: n.id })}>
                            <span className="note-card-icon">{n.icon || "📝"}</span>
                            <span className="note-card-title">{n.title || "제목 없음"}</span>
                            <span className="note-card-meta">{timeAgo(n.updated_at)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
            </>
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
              <div className="page-icon">📊</div>
              <h1 className="page-title">학습 통계</h1>
              <StatsSection />
            </>
          )}

          {view.type === "settings" && (
            <>
              <div className="page-icon">⚙️</div>
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
            />
          ) : <div className="loading-wrap"><div className="spinner" /></div>)}

          {view.type === "gnote" && (
            <Suspense fallback={<div className="loading-wrap"><div className="spinner" /></div>}>
            <GroupNotePage
              key={view.noteId}
              noteId={view.noteId}
              user={user}
              group={group?.detail}
              onSaved={() => loadGroup(groupId)}
              onDeleted={() => { loadGroup(groupId); setView({ type: "group", groupId }); }}
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
              onDeleted={(id) => { setNotes(prev => prev.filter(n => n.id !== id)); setView({ type: "home" }); }}
              onOpenDoc={(id, name) => selectDoc(id, name, "summary")}
            />
            </Suspense>
          )}

          {view.type === "doc" && (
            <>
              <div className="page-icon">📄</div>
              <h1 className="page-title page-title--doc" title={currentDoc?.filename}>
                {currentDoc?.filename?.replace(/\.pdf$/i, "")}
              </h1>

              {groupDoc && (
                <p className="doc-uploader">
                  👥 {group.detail.name} · <strong>{groupDoc.uploader_name}</strong>님이 {groupTimeAgo(groupDoc.created_at)} 올림
                </p>
              )}
              <div className="doc-meta-row">
                {docNotes.map(n => (
                  <button key={n.id} className="doc-note-chip" onClick={() => setView({ type: "note", noteId: n.id })}>
                    {n.icon || "📝"} {n.title || "제목 없음"}
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
                  <span className="error-icon">⚠️</span>
                  <span style={{ flex: 1 }}>
                    이미지 인식에 실패했어요. 무료 AI 모델이 잠시 붐비는 경우가 많아요 — 잠시 후 다시 시도해주세요.
                    {docStatus?.error && <><br /><small style={{ opacity: .75 }}>{docStatus.error}</small></>}
                  </span>
                  <button className="btn-primary" onClick={retryRecognition}>다시 시도</button>
                </div>
              )}

              {(docStatusValue === "done" || docStatusValue === null) && <div key={docId}>
                {[
                  ["summary", <SummarySection key="summary" docId={docId} onSaveNote={saveToNote} />],
                  ["qa",      <QASection key="qa" docId={docId} onSaveNote={saveToNote} />],
                  ["tutor",   <TutorSection key="tutor" docId={docId} />],
                  ["quiz",    <QuizSection key="quiz" docId={docId} onGoToWrong={() => { setView(v => ({ ...v, tab: "wrong" })); setWrongRefreshKey(k => k + 1); }} />],
                  ["wrong",   <WrongAnswerBook key="wrong" docId={docId} refreshKey={wrongRefreshKey}
                                onCountLoaded={setWrongCount}
                                onGoToQuiz={() => setView(v => ({ ...v, tab: "quiz" }))} />],
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
