import { useState } from "react";

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
        <div className="note-prop">
          <span className="note-prop-key">초대 코드</span>
          <code className="group-code">{group.invite_code}</code>
          <button className="note-prop-link" onClick={copyCode}>{copied ? "복사됨" : "복사"}</button>
        </div>
        <div className="note-prop">
          <span className="note-prop-key">멤버</span>
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

export function GroupStart({ me, onCreate, onJoin }) {
  const defaultName = me.displayName || me.email?.split("@")[0] || "";
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [nick, setNick] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn) {
    setBusy(true); setError("");
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
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
        <form className="room-create-block" onSubmit={e => { e.preventDefault(); run(() => onCreate(name, nick)); }}>
          <p className="room-block-title">새 그룹 만들기</p>
          <p className="room-block-desc">만들면 초대 코드가 생겨요. 코드를 친구에게 보내주세요.</p>
          <input className="input" value={name} maxLength={64} placeholder="그룹 이름 (예: 자료구조 스터디)"
            onChange={e => setName(e.target.value)} />
          <button className="btn-primary" type="submit" disabled={busy || !name.trim() || !nick.trim()}>만들기</button>
        </form>
        <form className="room-join-block" onSubmit={e => { e.preventDefault(); run(() => onJoin(code, nick)); }}>
          <p className="room-block-title">초대 코드로 참가</p>
          <p className="room-block-desc">친구에게 받은 6자리 코드를 입력하세요.</p>
          <input className="input group-code-input" value={code} maxLength={6} placeholder="ABC123"
            onChange={e => setCode(e.target.value.toUpperCase())} />
          <button className="btn-primary" type="submit" disabled={busy || code.trim().length < 6 || !nick.trim()}>참가하기</button>
        </form>
      </div>
    </div>
  );
}
