import { useState, useEffect } from "react";
import { apiFetch } from "../api.js";

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

export function Avatar({ name = "?", online, size = 22 }) {
  return (
    <span className={`avatar ${online ? "avatar--online" : ""}`} style={{ width: size, height: size, fontSize: size * 0.48 }} title={name}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function GroupHome({
  group, docs, notes, online, me, realtime,
  uploading, onUpload, onOpenDoc, onOpenNote, onNewNote, onDeleteDoc, onLeave,
  quiz, onJoinQuiz,
}) {
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    apiFetch(`/groups/${group.id}/activity`).then(setActivity).catch(() => {});
  }, [group.id, docs.length, notes.length]);

  const onlineIds = new Set((online || []).map(o => o.user_id));
  const viewingOf = (uid) => (online || []).find(o => o.user_id === uid)?.viewing;
  const viewers = (key) => (online || []).filter(o => o.viewing === key && o.user_id !== me.uid);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(group.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 클립보드 권한 없음 — 코드는 화면에 보인다 */ }
  }

  return (
    <div className="group-home">
      <div className="page-icon">👥</div>
      <h1 className="page-title">{group.name}</h1>

      {/* 속성 */}
      <div className="note-props">
        {(group.level || group.subject || group.visibility) && (
          <div className="note-prop">
            <span className="note-prop-key">카테고리</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {group.visibility === "public" ? <span className="group-tag">🌐 공개방</span> : <span className="group-tag">🔒 초대전용</span>}
              {group.level && <span className="group-tag">{group.level}</span>}
              {group.subject && <span className="group-tag">{group.subject}</span>}
            </div>
          </div>
        )}
        <div className="note-prop">
          <span className="note-prop-key">초대 코드</span>
          <code className="group-code">{group.invite_code}</code>
          <button className="note-prop-link" onClick={copyCode}>{copied ? "복사됨" : "복사"}</button>
        </div>
        <div className="note-prop">
          <span className="note-prop-key">
            멤버{realtime && <span className="group-online-count"> · 접속 {group.members.filter(m => onlineIds.has(m.user_id) || m.user_id === me.uid).length}/{group.members.length}</span>}
          </span>
          <div className="group-members">
            {group.members.map(m => {
              const isOnline = onlineIds.has(m.user_id) || m.user_id === me.uid;
              const v = viewingOf(m.user_id);
              return (
                <span key={m.user_id} className="group-member" title={v ? `${m.display_name} — 보는 중: ${v}` : m.display_name}>
                  <Avatar name={m.display_name} online={realtime && isOnline} />
                  <span className="group-member-name">{m.display_name}{m.user_id === me.uid && " (나)"}</span>
                  {m.role === "owner" && <span className="group-owner-tag">그룹장</span>}
                </span>
              );
            })}
          </div>
        </div>
        {!realtime && (
          <div className="note-prop">
            <span className="note-prop-key">실시간</span>
            <span className="note-prop-val">꺼짐 — Supabase 환경변수가 설정되지 않았어요</span>
          </div>
        )}
      </div>

      {quiz && quiz.by !== me.uid && (
        <div className="callout callout--quiz">
          <span>🏆</span>
          <span style={{ flex: 1 }}>
            <strong>{quiz.by_name}</strong>님이 "{quiz.filename?.replace(/\.pdf$/i, "")}" 그룹 퀴즈 방을 열었어요 · 코드 <code className="group-code">{quiz.code}</code>
          </span>
          <button className="btn-primary" onClick={() => onJoinQuiz(quiz)}>참가하기</button>
        </div>
      )}

      {/* 공유 자료 */}
      <section className="dash-section">
        <div className="dash-section-header">
          <p className="dash-section-title">공유 자료</p>
          <label className="btn-ghost" style={{ cursor: uploading ? "default" : "pointer" }}>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={uploading}
              onChange={e => { if (e.target.files?.[0]) { onUpload(e.target.files[0]); e.target.value = ""; } }} />
            {uploading ? "분석 중…" : "+ 자료 올리기"}
          </label>
        </div>
        {docs.length === 0 ? (
          <p className="group-empty">아직 공유된 자료가 없어요. PDF를 올리면 멤버 모두가 함께 볼 수 있어요.</p>
        ) : (
          <div className="group-table" role="table">
            <div className="group-row group-row--head" role="row">
              <span>이름</span><span>올린 사람</span><span>올린 시각</span><span />
            </div>
            {docs.map(d => {
              const watching = viewers(`doc:${d.doc_id}`);
              return (
                <div key={d.doc_id} className="group-row" role="row">
                  <button className="group-cell-main" onClick={() => onOpenDoc(d)} title={d.filename}>
                    <span className="sb-icon">{(d.status === "processing" ? "⏳" : d.status === "failed" ? "⚠️" : "📄")}</span>
                    <span className="group-cell-title">{d.filename.replace(/\.pdf$/i, "")}</span>
                    {d.status === "processing" && <span className="group-watching">인식 중</span>}
                    {d.status === "failed" && <span className="group-failed">인식 실패</span>}
                    {watching.length > 0 && <span className="group-watching">{watching.map(w => w.name).join(", ")} 보는 중</span>}
                  </button>
                  <span className="group-cell-person"><Avatar name={d.uploader_name} size={18} />{d.uploader_name}</span>
                  <span className="group-cell-time">{timeAgo(d.created_at)}</span>
                  <span className="group-cell-actions">
                    {(d.uploaded_by === me.uid || group.my_role === "owner") && (
                      confirmDel === d.doc_id ? (
                        <>
                          <button className="btn-danger" onClick={() => { setConfirmDel(null); onDeleteDoc(d); }}>삭제</button>
                          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>취소</button>
                        </>
                      ) : (
                        <button className="past-doc-del" title="삭제" onClick={() => setConfirmDel(d.doc_id)}>×</button>
                      )
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 공동 노트 */}
      <section className="dash-section">
        <div className="dash-section-header">
          <p className="dash-section-title">공동 노트</p>
          <button className="btn-ghost" onClick={() => onNewNote()}>+ 새 노트</button>
        </div>
        {notes.length === 0 ? (
          <button className="note-empty" onClick={() => onNewNote()}>
            <span>📄</span> 함께 쓸 첫 노트를 만들어보세요. 멤버 모두가 실시간으로 같이 편집할 수 있어요.
          </button>
        ) : (
          <div className="group-table" role="table">
            {notes.map(n => {
              const editing = viewers(`note:${n.id}`);
              return (
                <div key={n.id} className="group-row group-row--note" role="row">
                  <button className="group-cell-main" onClick={() => onOpenNote(n)}>
                    <span className="sb-icon">{n.icon || "📄"}</span>
                    <span className="group-cell-title">{n.title || "제목 없음"}</span>
                    {editing.length > 0 && (
                      <span className="group-editing">
                        {editing.map(e => <Avatar key={e.user_id} name={e.name} online size={16} />)}
                        편집 중
                      </span>
                    )}
                  </button>
                  <span className="group-cell-person">
                    <Avatar name={n.last_editor_name || n.creator_name} size={18} />
                    {n.last_editor_name || n.creator_name}
                  </span>
                  <span className="group-cell-time">{timeAgo(n.updated_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 멤버 활동량 */}
      {activity.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <p className="dash-section-title">멤버 활동량</p>
          </div>
          <div className="group-table" role="table">
            <div className="group-row group-row--head" role="row">
              <span>멤버</span><span>자료 업로드</span><span>노트 작성</span>
            </div>
            {activity.map(a => (
              <div key={a.user_id} className="group-row" role="row">
                <span className="group-cell-person">
                  <Avatar name={a.display_name} online={onlineIds.has(a.user_id) || a.user_id === me.uid} size={18} />
                  {a.display_name}
                  {a.user_id === me.uid && " (나)"}
                  {a.role === "owner" && <span className="group-owner-tag">그룹장</span>}
                </span>
                <span className="group-cell-time">{a.uploads}개</span>
                <span className="group-cell-time">{a.notes}개</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="note-footer">
        {group.my_role !== "owner" && (confirmLeave ? (
          <>
            <span className="note-footer-text">그룹에서 나갈까요? 올린 자료와 노트는 그룹에 남아요.</span>
            <button className="btn-danger" onClick={onLeave}>나가기</button>
            <button className="btn-ghost" onClick={() => setConfirmLeave(false)}>취소</button>
          </>
        ) : (
          <button className="btn-ghost" onClick={() => setConfirmLeave(true)}>그룹 나가기</button>
        ))}
      </div>
    </div>
  );
}

const LEVELS = ["초등", "중등", "고등", "대학", "고시/취업"];

export function GroupStart({ me, onCreate, onJoin, onJoinPublic }) {
  const defaultName = me.displayName || me.email?.split("@")[0] || "";
  const [nick, setNick] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 만들기
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("code");
  const [level, setLevel] = useState("");
  const [subject, setSubject] = useState("");

  // 참가
  const [code, setCode] = useState("");

  // 공개방 검색
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
      const { apiFetch } = await import("../api.js");
      const data = await apiFetch(`/groups/search?${params}`);
      setResults(data);
    } catch { setResults([]); } finally { setSearching(false); }
  }

  return (
    <div>
      <div className="page-icon">👥</div>
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
        {/* ── 만들기 ── */}
        <form className="room-create-block" onSubmit={e => { e.preventDefault(); run(() => onCreate(name, nick, visibility, level || null, subject || null)); }}>
          <p className="room-block-title">새 그룹 만들기</p>
          <input className="input" value={name} maxLength={64} placeholder="그룹 이름 (예: 고1 수학 내신)"
            onChange={e => setName(e.target.value)} />

          <div className="group-meta-row">
            <select className="input group-select" value={level} onChange={e => setLevel(e.target.value)}>
              <option value="">학교급 (선택)</option>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <input className="input" value={subject} maxLength={64} placeholder="과목 (선택, 예: 수학)"
              onChange={e => setSubject(e.target.value)} />
          </div>

          <div className="group-visibility-row">
            <label className={`visibility-opt ${visibility === "code" ? "active" : ""}`}>
              <input type="radio" name="vis" value="code" checked={visibility === "code"} onChange={() => setVisibility("code")} />
              🔒 초대코드 전용
            </label>
            <label className={`visibility-opt ${visibility === "public" ? "active" : ""}`}>
              <input type="radio" name="vis" value="public" checked={visibility === "public"} onChange={() => setVisibility("public")} />
              🌐 공개방
            </label>
          </div>

          <button className="btn-primary" type="submit" disabled={busy || !name.trim() || !nick.trim()}>만들기</button>
        </form>

        {/* ── 참가 ── */}
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
              <option value="">전체 학교급</option>
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
