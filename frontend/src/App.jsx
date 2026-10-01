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
import NotePage from "./components/NotePage";
import GroupHome, { GroupStart, timeAgo as groupTimeAgo } from "./components/GroupHome";
import { useGroupChannels } from "./realtime/useGroupChannels";
import "./App.css";

// 블록 에디터(BlockNote)는 무거워서 공동 노트를 열 때만 불러온다
const GroupNotePage = lazy(() => import("./components/GroupNotePage"));

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

  const pushNotif = (text, groupId) =>
    setNotifications(prev => [{ id: Date.now(), text, groupId, time: new Date().toISOString(), unread: true }, ...prev].slice(0, 50));

  const { online, notify, setViewing, enabled: realtime } = useGroupChannels(groups, user, (groupId, ev) => {
    loadGroup(groupId);
    let msg = "";
    if (ev.event === "doc-added")     msg = `${ev.by_name}님이 "${ev.filename}" 자료를 올렸어요`;
    else if (ev.event === "note-added")   msg = `${ev.by_name}님이 새 공동 노트를 만들었어요`;
    else if (ev.event === "member-joined") msg = `${ev.by_name}님이 그룹에 참가했어요`;
    else if (ev.event === "quiz-room") {
      setGroupQuiz(q => ({ ...q, [groupId]: ev }));
      msg = `${ev.by_name}님이 그룹 퀴즈 방을 열었어요 (코드 ${ev.code})`;
    }
    if (msg) { setToast(msg); pushNotif(msg, groupId); }
  });

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      if (u) {
        setUserId(u.uid);
        setServerWaking(false);
        apiFetch("/documents/")
          .then(data => { setPastDocs(data); setServerWaking(false); })
          .catch(err => {
            if (err.isColdStart) setServerWaking(true);
          });
        apiFetch("/notes/").then(setNotes).catch(() => {});
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
      setPastDocs(prev => [{ doc_id: data.doc_id, filename: data.filename, created_at: new Date().toISOString() }, ...prev]);
      setPreJoined(null);
      setView({ type: "doc", docId: data.doc_id, filename: data.filename, tab: "summary" });

      // 이미지: 백그라운드 OCR 완료까지 폴링
      if (data.status === "processing") {
        const pollDone = await _pollUploadStatus(data.doc_id);
        if (!pollDone) setError("이미지 분석에 실패했습니다. 다시 시도해 주세요.");
      }
    } catch (err) {
      if (err.isColdStart) setServerWaking(true);
      else setError(err.message);
    }
    finally { setUploading(false); }
  }

  async function _pollUploadStatus(docId, maxWaitMs = 120000) {
    const interval = 3000;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      try {
        const s = await apiFetch(`/documents/upload-status/${docId}`);
        if (s.status === "done") return true;
        if (s.status === "failed") return false;
      } catch { /* 일시적 네트워크 오류는 무시 */ }
    }
    return false;
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

  async function createGroup(name, displayName) {
    const g = await apiFetch("/groups/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, display_name: displayName }),
    });
    setGroups(prev => [...prev, g]);
    await loadGroup(g.id);
    setView({ type: "group", groupId: g.id });
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
      await apiFetch(`/groups/${id}/members/me`, { method: "DELETE" });
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
        pastDocs={pastDocs} notes={notes} wrongCount={wrongCount}
        onNewNote={(doc_id) => createNote({ doc_id: doc_id || null })}
        onUpload={handleFilesAccepted} uploading={uploading}
        onLogout={logout}
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
        groups={groups} groupData={groupData} online={online}
        onNewGroupNote={createGroupNote}
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
                onClick={() => {
                  setNotifOpen(o => !o);
                  setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
                }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {notifications.some(n => n.unread) && (
                  <span className="notif-dot">{notifications.filter(n => n.unread).length}</span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="notif-backdrop" onClick={() => setNotifOpen(false)} />
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
                        onClick={() => { if (n.groupId) { setView({ type: "group", groupId: n.groupId }); setNotifOpen(false); } }}>
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

        <div className="page">
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

              <DashboardHome
                onFileAccepted={handleFilesAccepted}
                onSelectDoc={(id, name) => selectDoc(id, name, "summary")}
                onSelectDocTab={selectDoc}
                onDeleteDoc={handleDeleteDoc}
                pastDocs={pastDocs}
                uploading={uploading}
                onPastDocsChange={() => apiFetch("/documents/").then(setPastDocs).catch(() => {})}
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
            <GroupStart me={user} onCreate={createGroup} onJoin={joinGroup} />
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
            <NotePage
              key={view.noteId}
              noteId={view.noteId}
              pastDocs={pastDocs}
              onChanged={(saved) => setNotes(prev => [{ ...saved, content: undefined }, ...prev.filter(n => n.id !== saved.id)])}
              onDeleted={(id) => { setNotes(prev => prev.filter(n => n.id !== id)); setView({ type: "home" }); }}
              onOpenDoc={(id, name) => selectDoc(id, name, "summary")}
            />
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

              <div key={docId}>
                {[
                  ["summary", <SummarySection key="summary" docId={docId} onSaveNote={saveToNote} />],
                  ["qa",      <QASection key="qa" docId={docId} onSaveNote={saveToNote} />],
                  ["tutor",   <TutorSection key="tutor" docId={docId} />],
                  ["quiz",    <QuizSection key="quiz" docId={docId} onGoToWrong={() => setView(v => ({ ...v, tab: "wrong" }))} />],
                  ["wrong",   <WrongAnswerBook key="wrong" docId={docId}
                                onCountLoaded={setWrongCount}
                                onGoToQuiz={() => setView(v => ({ ...v, tab: "quiz" }))} />],
                  ...(groupId ? [["room", <StudyRoomSection key="room" docId={docId} userId={user?.uid}
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
              </div>
            </>
          )}
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
