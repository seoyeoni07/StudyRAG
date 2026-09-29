import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "../api";

const POLL_INTERVAL = 3000;

export default function StudyRoomSection({ docId, userId }) {
  const [view, setView] = useState("home"); // home | lobby | quiz | result
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);
  const viewRef = useRef(view);

  // viewRef를 항상 최신 view로 유지 (클로저 스테일 방지)
  useEffect(() => { viewRef.current = view; }, [view]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPoll = useCallback((roomId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch(`/rooms/${roomId}`);
        setRoom(data);
        if (data.status === "active" && viewRef.current !== "quiz" && viewRef.current !== "result") {
          setView("quiz");
        }
        if (data.status === "finished" && viewRef.current !== "result") {
          setView("result");
          stopPoll();
        }
      } catch {}
    }, POLL_INTERVAL);
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  async function handleCreate() {
    if (!nickname.trim()) { setError("닉네임을 입력하세요."); return; }
    setError("");
    try {
      const { room_id } = await apiFetch("/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, nickname }),
      });
      const data = await apiFetch(`/rooms/${room_id}`);
      setRoom(data);
      setView("lobby");
      startPoll(room_id);
    } catch (err) { setError(err.message); }
  }

  async function handleJoin() {
    if (!nickname.trim()) { setError("닉네임을 입력하세요."); return; }
    if (!joinCode.trim()) { setError("방 코드를 입력하세요."); return; }
    setError("");
    try {
      const res = await apiFetch("/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim().toUpperCase(), nickname }),
      });
      const data = await apiFetch(`/rooms/${res.room_id}`);
      setRoom(data);
      setView(data.status === "active" ? "quiz" : "lobby");
      startPoll(res.room_id);
    } catch (err) { setError(err.message); }
  }

  async function handleStart() {
    setStarting(true);
    setError("");
    try {
      await apiFetch(`/rooms/${room.room_id}/start`, { method: "POST" });
      const data = await apiFetch(`/rooms/${room.room_id}`);
      setRoom(data);
      setView("quiz");
    } catch (err) {
      setError(err.message || "퀴즈 생성 실패. 잠시 후 다시 시도해주세요.");
    } finally { setStarting(false); }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/rooms/${room.room_id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([id, answer]) => ({ id: parseInt(id), answer: answer || "" })),
        }),
      });
      setSubmitted(true);
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  async function handleFinish() {
    try {
      await apiFetch(`/rooms/${room.room_id}/finish`, { method: "POST" });
      const data = await apiFetch(`/rooms/${room.room_id}`);
      setRoom(data);
      setView("result");
      stopPoll();
    } catch (err) { setError(err.message); }
  }

  function leave() {
    stopPoll();
    setRoom(null);
    setView("home");
    setAnswers({});
    setSubmitted(false);
    setStarting(false);
    setError("");
  }

  const isHost = room && userId && room.host_user_id === userId;
  const submittedCount = room?.members?.filter(m => m.submitted_at).length ?? 0;
  const totalCount = room?.members?.length ?? 0;

  if (view === "home") {
    return (
      <div className="room-home">
        {error && <div className="error-banner"><span className="error-icon">⚠️</span><span>{error}</span></div>}
        <div className="room-nick-row">
          <label className="room-field-label">닉네임</label>
          <input
            className="input" placeholder="표시될 이름" value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>
        <div className="room-actions">
          <div className="room-create-block">
            <h4 className="room-block-title">방 만들기</h4>
            <p className="room-block-desc">현재 강의자료로 친구들과 함께 퀴즈를 풀어보세요.</p>
            <button className="btn-primary" onClick={handleCreate} disabled={!nickname.trim()}>방 만들기</button>
          </div>
          <div className="room-divider" />
          <div className="room-join-block">
            <h4 className="room-block-title">방 참가</h4>
            <p className="room-block-desc">친구에게 받은 6자리 코드를 입력하세요.</p>
            <input
              className="input" placeholder="방 코드 (예: AB12CD)" value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6} style={{ marginBottom: 8 }}
            />
            <button className="btn-secondary" onClick={handleJoin} disabled={!nickname.trim() || joinCode.length < 4}>
              참가하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "lobby") {
    return (
      <div className="room-lobby">
        <div className="room-code-display">
          <span className="room-code-label">방 코드</span>
          <span className="room-code">{room?.code}</span>
          <span className="room-code-hint">친구에게 이 코드를 알려주세요</span>
        </div>

        {error && <div className="error-banner"><span className="error-icon">⚠️</span><span>{error}</span></div>}

        <div className="room-members">
          <p className="room-members-label">참가자 ({totalCount}명)</p>
          {(room?.members || []).map((m) => (
            <div key={m.user_id} className="room-member-row">
              <span className="room-member-nick">{m.nickname}</span>
              {room.host_user_id === m.user_id && <span className="room-host-badge">호스트</span>}
            </div>
          ))}
        </div>

        <div className="room-lobby-actions">
          {isHost ? (
            <button className="btn-primary" onClick={handleStart} disabled={starting}>
              {starting
                ? <><div className="spinner spinner-sm" /> 퀴즈 생성 중… (10~20초)</>
                : `퀴즈 시작 (${totalCount}명)`
              }
            </button>
          ) : (
            <p className="room-wait">호스트가 퀴즈를 시작할 때까지 기다리세요…</p>
          )}
          <button className="btn-secondary" onClick={leave}>나가기</button>
        </div>
      </div>
    );
  }

  if (view === "quiz") {
    if (!room?.questions) {
      return (
        <div className="loading-wrap" style={{ flexDirection: "column", gap: 12, padding: "40px 0" }}>
          <div className="spinner" />
          <span className="loading-text">퀴즈 로딩 중…</span>
        </div>
      );
    }
    return (
      <div>
        <div className="room-quiz-header">
          <span className="room-badge">그룹 스터디</span>
          <span className="room-submit-count">제출 {submittedCount}/{totalCount}명</span>
          {submitted && <span className="room-submitted">제출 완료</span>}
          {isHost && (
            <button className="btn-secondary room-finish-btn" onClick={handleFinish}>
              결과 보기
            </button>
          )}
        </div>

        {error && <div className="error-banner"><span className="error-icon">⚠️</span><span>{error}</span></div>}

        {room.questions.map((q) => (
          <div key={q.id} className="question-item" style={{ opacity: submitted ? 0.65 : 1 }}>
            <div className="q-num">문제 {q.id}</div>
            <p className="q-text">{q.question}</p>
            {q.type === "multiple_choice" ? (
              <div className="options">
                {q.options.map((opt) => {
                  const letter = opt[0];
                  return (
                    <label key={opt} className="option-label">
                      <input type="radio" name={`rq-${q.id}`} value={letter}
                        disabled={submitted}
                        checked={answers[q.id] === letter}
                        onChange={() => !submitted && setAnswers((p) => ({ ...p, [q.id]: letter }))}
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : (
              <input type="text" className="input" placeholder="답변 입력"
                disabled={submitted}
                value={answers[q.id] || ""}
                onChange={(e) => !submitted && setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
              />
            )}
          </div>
        ))}

        {!submitted && (
          <div className="quiz-submit-row">
            <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><div className="spinner spinner-sm" /> 제출 중…</> : "제출하기"}
            </button>
          </div>
        )}

        {submitted && !isHost && (
          <p className="room-wait" style={{ textAlign: "center", padding: "16px 0" }}>
            다른 참가자가 풀고 있습니다… 호스트가 결과를 공개하면 순위가 표시됩니다.
          </p>
        )}
      </div>
    );
  }

  if (view === "result") {
    const sorted = [...(room?.members || [])].sort((a, b) => {
      if (b.score == null) return -1;
      if (a.score == null) return 1;
      return b.score - a.score;
    });
    return (
      <div className="room-result">
        <h3 className="room-result-title">최종 순위</h3>
        {sorted.map((m, i) => (
          <div key={m.user_id} className={`leaderboard-row ${i === 0 ? "first" : ""}`}>
            <span className="leaderboard-rank">{i + 1}</span>
            <span className="leaderboard-nick">{m.nickname}</span>
            <span className="leaderboard-score">
              {m.score != null ? `${m.score}/${m.total} (${Math.round(m.score/m.total*100)}%)` : "미제출"}
            </span>
          </div>
        ))}
        <button className="btn-secondary" style={{ marginTop: 20 }} onClick={leave}>홈으로</button>
      </div>
    );
  }

  return null;
}
