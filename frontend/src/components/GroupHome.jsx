import { useState, useEffect } from "react";
import { apiFetch } from "../api.js";
import { PeerQuestions, GroupRanking } from "./learn/GroupLearning";
import { LockIcon, GlobeIcon, UsersIcon, DocIcon, NoteIcon, renderNoteIcon, WarningIcon, SpinnerIcon } from "./Icons.jsx";

export function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  if (m < 10080) return `${Math.round(m / 1440)}일 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

export function Avatar({ name = "?", photo, online, size = 22 }) {
  return (
    <span className={`avatar ${online ? "avatar--online" : ""}`} style={{ width: size, height: size, fontSize: size * 0.48 }} title={name}>
      {photo
        ? <img src={photo} alt={name} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" />
        : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function GroupHome({
  group, docs, notes, online, me, realtime,
  uploading, onUpload, onOpenDoc, onOpenNote, onNewNote, onDeleteDoc, onLeave,
  quiz, onJoinQuiz, onReload, onOpenPlanner, onToast,
}) {
  const [tab, setTab] = useState("home");
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [activity, setActivity] = useState([]);
  const [editingAnn, setEditingAnn] = useState(false);
  const [annText, setAnnText] = useState(group.announcement || "");
  const [annBusy, setAnnBusy] = useState(false);
  const [quizHistory, setQuizHistory] = useState([]);

  useEffect(() => {
    apiFetch(`/groups/${group.id}/activity`).then(setActivity).catch(() => {});
  }, [group.id, docs.length, notes.length]);

  useEffect(() => {
    if (tab === "activity" && quizHistory.length === 0)
      apiFetch(`/groups/${group.id}/quiz-history`).then(setQuizHistory).catch(() => {});
  }, [tab, group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onlineIds = new Set((online || []).map(o => o.user_id));
  const viewingOf = (uid) => (online || []).find(o => o.user_id === uid)?.viewing;
  const viewers = (key) => (online || []).filter(o => o.viewing === key && o.user_id !== me.uid);

  async function saveAnnouncement() {
    setAnnBusy(true);
    try {
      if (annText.trim()) {
        await apiFetch(`/groups/${group.id}/announcement`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: annText }),
        });
      } else {
        await apiFetch(`/groups/${group.id}/announcement`, { method: "DELETE" });
      }
      setEditingAnn(false);
      onReload?.();
    } catch { /* 무시 */ } finally { setAnnBusy(false); }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(group.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onToast?.(`초대 코드 ${group.invite_code} 복사됨`);
    } catch { /* 코드는 화면에 보인다 */ }
  }

  const TABS = [
    { key: "home", label: "홈" },
    { key: "docs", label: `자료 ${docs.length > 0 ? `(${docs.length})` : ""}` },
    { key: "notes", label: `노트 ${notes.length > 0 ? `(${notes.length})` : ""}` },
    { key: "questions", label: "문제" },
    { key: "ranking", label: "랭킹" },
    { key: "activity", label: "활동" },
  ];

  return (
    <div className="group-home">
      {/* 헤더 */}
      <div className="group-header">
        <div className="group-header-left">
          <h1 className="group-header-title">{group.name}</h1>
          <div className="group-header-meta">
            {group.visibility === "public"
              ? <span className="group-tag group-tag--public"><GlobeIcon size="0.85em" /> 공개방</span>
              : <span className="group-tag group-tag--private"><LockIcon size="0.85em" /> 초대전용</span>}
            {group.level && <span className="group-tag">{group.level}</span>}
            {group.subject && <span className="group-tag">{group.subject}</span>}
            <span className="group-tag">멤버 {group.members.length}명</span>
            {realtime && (
              <span className="group-tag group-tag--online">
                접속 {group.members.filter(m => onlineIds.has(m.user_id) || m.user_id === me.uid).length}명
              </span>
            )}
          </div>
        </div>
        {onOpenPlanner && (
          <button className="btn-secondary btn-sm" onClick={onOpenPlanner}>플래너</button>
        )}
      </div>

      {/* 퀴즈 알림 */}
      {quiz && quiz.by !== me.uid && (
        <div className="callout callout--quiz">
          <span style={{ flex: 1 }}>
            <strong>{quiz.by_name}</strong>님이 "{quiz.filename?.replace(/\.pdf$/i, "")}" 그룹 퀴즈를 열었어요 · 코드 <code className="group-code">{quiz.code}</code>
          </span>
          <button className="btn-primary" onClick={() => onJoinQuiz(quiz)}>참가하기</button>
        </div>
      )}

      {/* 탭 */}
      <div className="group-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`group-tab${tab === t.key ? " group-tab--active" : ""}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ── 홈 탭 ── */}
      {tab === "home" && (
        <div className="group-tab-body">
          {/* 공지사항 */}
          {(group.announcement || group.my_role === "owner") && (
            <div className="dash-panel">
              <div className="dash-panel-head">
                <span className="dash-panel-title">공지사항</span>
                {group.my_role === "owner" && !editingAnn && (
                  <button className="btn-ghost btn-sm" onClick={() => setEditingAnn(true)}>
                    {group.announcement ? "수정" : "공지 등록"}
                  </button>
                )}
              </div>
              <div style={{ padding: "12px 16px" }}>
                {editingAnn ? (
                  <div className="group-ann-edit">
                    <textarea className="group-ann-textarea" value={annText} maxLength={500}
                      placeholder="그룹 공지를 입력하세요 (500자 이내)…"
                      onChange={e => setAnnText(e.target.value)} />
                    <div className="group-ann-actions">
                      <button className="btn-primary btn-sm" onClick={saveAnnouncement} disabled={annBusy}>저장</button>
                      <button className="btn-ghost btn-sm" onClick={() => { setEditingAnn(false); setAnnText(group.announcement || ""); }}>취소</button>
                    </div>
                  </div>
                ) : group.announcement ? (
                  <p className="group-ann-text">{group.announcement}</p>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--text-4)" }}>아직 공지가 없어요.</p>
                )}
              </div>
            </div>
          )}

          {/* 멤버 */}
          <div className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-title">멤버</span>
              {group.visibility !== "public" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>초대 코드</span>
                  <code className="group-code">{group.invite_code}</code>
                  <button className="btn-ghost btn-sm" onClick={copyCode}>{copied ? "복사됨" : "복사"}</button>
                </div>
              )}
            </div>
            <div className="group-member-grid">
              {group.members.map(m => {
                const isOnline = onlineIds.has(m.user_id) || m.user_id === me.uid;
                const v = viewingOf(m.user_id);
                return (
                  <div key={m.user_id} className="group-member-card" title={v ? `${m.display_name} — 보는 중: ${v}` : undefined}>
                    <Avatar name={m.display_name} photo={m.photo_url || (m.user_id === me.uid ? me.photoURL : null)} online={realtime && isOnline} size={32} />
                    <div className="group-member-info">
                      <span className="group-member-name">{m.display_name}{m.user_id === me.uid && " (나)"}</span>
                      {m.role === "owner" && <span className="group-owner-tag">그룹장</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 푸터 */}
          <div className="note-footer">
            {group.my_role === "owner" ? (confirmLeave ? (
              <>
                <span className="note-footer-text">그룹을 삭제할까요? 모든 자료와 노트가 사라져요.</span>
                <button className="btn-danger" onClick={onLeave}>삭제</button>
                <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>취소</button>
              </>
            ) : (
              <button className="btn-ghost" onClick={() => setConfirmLeave(true)}>그룹 삭제</button>
            )) : (confirmLeave ? (
              <>
                <span className="note-footer-text">그룹에서 나갈까요?</span>
                <button className="btn-danger" onClick={onLeave}>나가기</button>
                <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>취소</button>
              </>
            ) : (
              <button className="btn-ghost" onClick={() => setConfirmLeave(true)}>그룹 나가기</button>
            ))}
          </div>
        </div>
      )}

      {/* ── 자료 탭 ── */}
      {tab === "docs" && (
        <div className="group-tab-body">
          <div className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-title">공유 자료</span>
              <label className="btn-primary btn-sm" style={{ cursor: uploading ? "default" : "pointer" }}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading}
                  onChange={e => { if (e.target.files?.[0]) { onUpload(e.target.files[0]); e.target.value = ""; } }} />
                {uploading ? "분석 중…" : "+ 자료 올리기"}
              </label>
            </div>
            {docs.length === 0 ? (
              <label className="dash-empty-upload" style={{ borderRadius: 0, border: "none", borderTop: "1px solid var(--border)" }}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading}
                  onChange={e => { if (e.target.files?.[0]) { onUpload(e.target.files[0]); e.target.value = ""; } }} />
                <p className="upload-heading">PDF나 이미지를 올려보세요</p>
                <p className="upload-sub">멤버 모두가 함께 볼 수 있어요.</p>
              </label>
            ) : (
              <div className="dash-doc-table">
                <div className="group-row group-row--head" style={{ padding: "6px 16px" }}>
                  <span style={{ flex: 1 }}>이름</span>
                  <span style={{ width: 80 }}>올린 사람</span>
                  <span style={{ width: 80 }}>시각</span>
                  <span style={{ width: 48 }} />
                </div>
                {docs.map(d => {
                  const watching = viewers(`doc:${d.doc_id}`);
                  return (
                    <div key={d.doc_id} className="dash-doc-row">
                      <button className="dash-doc-main" onClick={() => onOpenDoc(d)}>
                        <span className="dash-doc-icon">{d.status === "processing" ? <SpinnerIcon size="1em" className="spin" /> : d.status === "failed" ? <WarningIcon size="1em" /> : <DocIcon />}</span>
                        <span className="dash-doc-name">{d.filename.replace(/\.pdf$/i, "")}</span>
                        {d.status === "processing" && <span className="dash-doc-status">인식 중</span>}
                        {watching.length > 0 && <span className="group-watching">{watching.map(w => w.name).join(", ")} 보는 중</span>}
                      </button>
                      <span className="group-cell-person" style={{ width: 80, flexShrink: 0 }}>
                        <Avatar name={d.uploader_name} size={16} />{d.uploader_name}
                      </span>
                      <span className="dash-doc-date" style={{ width: 80, flexShrink: 0 }}>{timeAgo(d.created_at)}</span>
                      <div className="dash-doc-actions" style={{ width: 48, flexShrink: 0, opacity: 1 }}>
                        {(d.uploaded_by === me.uid || group.my_role === "owner") && (
                          confirmDel === d.doc_id ? (
                            <>
                              <button className="doc-action-btn doc-action-btn--del" onClick={() => { setConfirmDel(null); onDeleteDoc(d); }}>삭제</button>
                              <button className="doc-action-btn" onClick={() => setConfirmDel(null)}>취소</button>
                            </>
                          ) : (
                            <button className="doc-action-btn doc-action-btn--del" onClick={() => setConfirmDel(d.doc_id)}>×</button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 노트 탭 ── */}
      {tab === "notes" && (
        <div className="group-tab-body">
          <div className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-title">공동 노트</span>
              <button className="btn-primary btn-sm" onClick={() => onNewNote()}>+ 새 노트</button>
            </div>
            {notes.length === 0 ? (
              <div className="empty-state" style={{ cursor: "pointer" }} onClick={() => onNewNote()} role="button" tabIndex={0}>
                <NoteIcon size="2em" />
                <span className="empty-state-title">공동 노트가 없어요</span>
                <span className="empty-state-sub">클릭해서 멤버 모두가 함께 편집할 수 있는 첫 노트를 만들어보세요.</span>
              </div>
            ) : (
              <div className="dash-doc-table">
                <div className="group-row group-row--head" style={{ padding: "6px 16px" }}>
                  <span style={{ flex: 1 }}>제목</span>
                  <span style={{ width: 80 }}>마지막 편집</span>
                  <span style={{ width: 80 }}>수정 시각</span>
                </div>
                {notes.map(n => {
                  const editing = viewers(`note:${n.id}`);
                  return (
                    <div key={n.id} className="dash-doc-row">
                      <button className="dash-doc-main" onClick={() => onOpenNote(n)}>
                        <span className="dash-doc-icon">{renderNoteIcon(n.icon) || <NoteIcon />}</span>
                        <span className="dash-doc-name">{n.title || "제목 없음"}</span>
                        {editing.length > 0 && (
                          <span className="group-editing">
                            {editing.map(e => <Avatar key={e.user_id} name={e.name} online size={14} />)}
                            편집 중
                          </span>
                        )}
                      </button>
                      <span className="group-cell-person" style={{ width: 80, flexShrink: 0 }}>
                        <Avatar name={n.last_editor_name || n.creator_name} size={16} />
                        {n.last_editor_name || n.creator_name}
                      </span>
                      <span className="dash-doc-date" style={{ width: 80, flexShrink: 0 }}>{timeAgo(n.updated_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 문제 탭: 서로 문제 내고 풀기 ── */}
      {tab === "questions" && (
        <div className="group-tab-body">
          <PeerQuestions groupId={group.id} me={me.uid} isOwner={group.my_role === "owner"}
            docs={docs.filter(d => (d.status || "done") === "done")} />
        </div>
      )}

      {/* ── 랭킹 탭: 이번 주 공부 시간·문제 ── */}
      {tab === "ranking" && (
        <div className="group-tab-body">
          <GroupRanking groupId={group.id} me={me.uid} />
        </div>
      )}

      {/* ── 활동 탭 ── */}
      {tab === "activity" && (
        <div className="group-tab-body">
          {/* 멤버 활동량 */}
          {activity.length > 0 && (
            <div className="dash-panel">
              <div className="dash-panel-head">
                <span className="dash-panel-title">멤버 활동량</span>
              </div>
              <div className="dash-doc-table">
                <div className="group-row group-row--head" style={{ padding: "6px 16px" }}>
                  <span style={{ flex: 1 }}>멤버</span>
                  <span style={{ width: 80 }}>자료 업로드</span>
                  <span style={{ width: 80 }}>노트 작성</span>
                </div>
                {activity.map(a => (
                  <div key={a.user_id} className="dash-doc-row">
                    <span className="dash-doc-main" style={{ cursor: "default" }}>
                      <Avatar name={a.display_name} online={onlineIds.has(a.user_id) || a.user_id === me.uid} size={18} />
                      <span className="dash-doc-name">{a.display_name}{a.user_id === me.uid && " (나)"}</span>
                      {a.role === "owner" && <span className="group-owner-tag">그룹장</span>}
                    </span>
                    <span className="dash-doc-date" style={{ width: 80 }}>{a.uploads}개</span>
                    <span className="dash-doc-date" style={{ width: 80 }}>{a.notes}개</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 퀴즈 히스토리 */}
          <div className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-title">퀴즈 히스토리</span>
            </div>
            {quizHistory.length === 0 ? (
              <p className="dash-planner-empty">아직 퀴즈 기록이 없어요.</p>
            ) : (
              <div style={{ padding: "8px 0" }}>
                {quizHistory.map(r => (
                  <div key={r.room_id} className="quiz-hist-room">
                    <div className="quiz-hist-room-header">
                      <span className="quiz-hist-doc">{r.doc_name.replace(/\.pdf$/i, "")}</span>
                      <span className="quiz-hist-date">{new Date(r.created_at).toLocaleDateString("ko-KR")}</span>
                    </div>
                    <div className="quiz-hist-members">
                      {r.members.map((m, i) => (
                        <div key={m.nickname} className={`quiz-hist-member ${m.is_me ? "quiz-hist-member--me" : ""}`}>
                          <span className="quiz-hist-rank">{i + 1}</span>
                          <span className="quiz-hist-nick">{m.nickname}{m.is_me ? " (나)" : ""}</span>
                          <span className="quiz-hist-score">
                            {m.score ?? "—"}/{m.total ?? "—"}
                            {m.total ? ` (${Math.round(m.score / m.total * 100)}%)` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_MAP = {
  "초등":       ["국어", "수학", "영어", "과학", "사회", "기타"],
  "중등":       ["국어", "수학", "영어", "과학", "사회", "역사", "기타"],
  "고등(내신)": ["국어", "수학", "영어", "물리", "화학", "생명과학", "지구과학", "사회", "한국사", "기타"],
  "고등(수능)": ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사", "제2외국어", "기타"],
  "대학교":     ["공과대학", "인문사회", "경상·경영", "의약학", "사범대학", "예체능", "자연과학", "법학", "기타"],
  "대학원":     ["공학", "인문사회", "경영·경제", "의약학", "자연과학", "법학", "기타"],
  "공무원·고시":["9급 공무원", "7급 공무원", "5급(행정고시)", "사법·로스쿨", "경찰·소방", "기타"],
  "자격증":     ["IT·정보처리", "의료·보건", "금융·경제", "건축·토목", "기타"],
  "어학":       ["영어(토익·토플)", "영어(IELTS)", "일본어", "중국어", "기타"],
  "취업·이직":  ["IT·개발", "금융·경제", "마케팅·기획", "디자인", "공기업", "기타"],
  "기타":       [],
};
const LEVELS = Object.keys(CATEGORY_MAP);

export function GroupStart({ me, onCreate, onJoin, onJoinPublic }) {
  const defaultName = me.displayName || me.email?.split("@")[0] || "";
  const [nick, setNick] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("code");
  const [level, setLevel] = useState("");
  const [sublevel, setSublevel] = useState("");
  const [subject, setSubject] = useState("");

  const [code, setCode] = useState("");

  const [searchQ, setSearchQ] = useState("");
  const [searchLevel, setSearchLevel] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  async function run(fn) {
    setBusy(true); setError("");
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function doSearch() {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (searchQ) params.set("q", searchQ);
      if (searchLevel) params.set("level", searchLevel);
      const data = await apiFetch(`/groups/search?${params}`);
      setResults(data);
    } catch (err) { setError(err.message); setResults([]); } finally { setSearching(false); }
  }

  return (
    <div>
      <h1 className="page-title">그룹 스터디</h1>
      <p className="group-intro">
        자료를 같이 올리고, 노트를 실시간으로 함께 편집해요. Q&A와 AI 튜터 대화는 각자 따로 저장돼요.
      </p>

      {error && <div className="error-banner"><span>{error}</span></div>}

      <div className="note-props">
        <div className="note-prop">
          <span className="note-prop-key">내 표시 이름</span>
          <input className="input group-input" value={nick} maxLength={64}
            onChange={e => setNick(e.target.value)} placeholder="멤버들에게 보일 이름" />
        </div>
      </div>

      <div className="room-actions">
        <form className="room-create-block" onSubmit={e => { e.preventDefault(); run(() => onCreate(name, nick, visibility, level || null, sublevel || null, subject || null)); }}>
          <p className="room-block-title">새 그룹 만들기</p>
          <input className="input" value={name} maxLength={64} placeholder="그룹 이름 (예: 고1 수학 내신)"
            onChange={e => setName(e.target.value)} />
          <div className="group-meta-row">
            <select className="input group-select" value={level} onChange={e => { setLevel(e.target.value); setSublevel(""); }}>
              <option value="">카테고리 (선택)</option>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            {level && (CATEGORY_MAP[level] || []).length > 0 && (
              <select className="input group-select" value={sublevel} onChange={e => setSublevel(e.target.value)}>
                <option value="">세부 분야 (선택)</option>
                {CATEGORY_MAP[level].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
          <input className="input" value={subject} maxLength={64} placeholder="스터디 주제 (선택, 예: 미적분, 토익 900점)"
            onChange={e => setSubject(e.target.value)} />
          <div className="group-visibility-row">
            <label className={`visibility-opt ${visibility === "code" ? "active" : ""}`}>
              <input type="radio" name="vis" value="code" checked={visibility === "code"} onChange={() => setVisibility("code")} />
              <LockIcon size="0.9em" /> 초대코드 전용
            </label>
            <label className={`visibility-opt ${visibility === "public" ? "active" : ""}`}>
              <input type="radio" name="vis" value="public" checked={visibility === "public"} onChange={() => setVisibility("public")} />
              <GlobeIcon size="0.9em" /> 공개방
            </label>
          </div>
          <button className="btn-primary" type="submit" disabled={busy || !name.trim() || !nick.trim()}>만들기</button>
        </form>

        <div className="room-join-block">
          <form onSubmit={e => { e.preventDefault(); run(() => onJoin(code, nick)); }}>
            <p className="room-block-title">초대코드로 참가</p>
            <p className="room-block-desc">친구에게 받은 6자리 코드를 입력하세요.</p>
            <input className="input group-code-input" value={code} maxLength={6} placeholder="ABC123"
              onChange={e => setCode(e.target.value.toUpperCase())} />
            <button className="btn-primary" type="submit" disabled={busy || code.trim().length < 6 || !nick.trim()}>참가하기</button>
          </form>

          <div className="group-search-divider">또는 공개방 검색</div>

          <div className="group-search-row">
            <select className="input group-select" value={searchLevel} onChange={e => setSearchLevel(e.target.value)}>
              <option value="">전체 카테고리</option>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <input className="input" value={searchQ} placeholder="그룹명·과목 검색"
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()} />
            <button className="btn-secondary" type="button" onClick={doSearch} disabled={searching}>검색</button>
          </div>

          {results !== null && (
            results.length === 0
              ? <p className="sb-empty" style={{padding:"12px 0"}}>검색 결과가 없어요</p>
              : <div className="group-search-results">
                  {results.map(g => (
                    <div key={g.id} className="group-search-item">
                      <div>
                        <span className="group-search-name">{g.name}</span>
                        {g.level && <span className="group-tag">{g.level}</span>}
                        {g.sublevel && <span className="group-tag">{g.sublevel}</span>}
                        {g.subject && <span className="group-tag">{g.subject}</span>}
                        <span className="group-search-count">{g.member_count}명</span>
                      </div>
                      <button className="btn-primary btn-sm" disabled={busy || !nick.trim()}
                        onClick={() => run(() => onJoinPublic(g.id, nick))}>참가</button>
                    </div>
                  ))}
                </div>
          )}
        </div>
      </div>
    </div>
  );
}
