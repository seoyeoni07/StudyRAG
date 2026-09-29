import { useState, useEffect, useRef } from "react";
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
  const pollRef = useRef(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPoll(roomId) {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch(`/rooms/${roomId}`);
        setRoom(data);
        if (data.status === "active" && view !== "quiz" && view !== "result") setView("quiz");
        if (data.status === "finished") { setView("result"); stopPoll(); }
      } catch {}
    }, POLL_INTERVAL);
  }

  useEffect(() => () => stopPoll(), []);

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
      const { room_id } = await apiFetch("/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim().toUpperCase(), nickname }),
      });
      const data = await apiFetch(`/rooms/${room_id}`);
      setRoom(data);
      setView(data.status === "active" ? "quiz" : "lobby");
      startPoll(room_id);
    } catch (err) { setError(err.message); }
  }

  async function handleStart() {
    try {
      await apiFetch(`/rooms/${room.room_id}/start`, { method: "POST" });
      const data = await apiFetch(`/rooms/${room.room_id}`);
      setRoom(data);
      setView("quiz");
    } catch (err) { setError(err.message); }
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
    setError("");
  }

  const isHost = room && userId && room.host_user_id === userId;

  if (view === "home") {
    return (
      <div className="room-home">
        {error && <div className="error-banner"><span className="error-icon">⚠️</span><span>{error}</span></div>}
        <input
          className="input" placeholder="닉네임" value={nickname}
          onChange={(e) => setNickname(e.target.value)} style={{ marginBottom: 12 }}
        />
        <div className="room-actions">
          <div className="room-create-block">
            <h4 className="room-block-title">방 만들기</h4>
            <button className="btn-primary" onClick={handleCreate}>방 만들기</button>
          </div>
          <div className="room-divider" />
          <div className="room-join-block">
            <h4 className="room-block-title">방 참가</h4>
            <input
              className="input" placeholder="방 코드 (6자리)" value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6} style={{ marginBottom: 8 }}
            />
            <button className="btn-secondary" onClick={handleJoin}>참가하기</button>
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
          <span className="room-code">{room.code}</span>
          <span className="room-code-hint">친구에게 코드를 알려주세요</span>
        </div>
        {error && <div className="error-banner"><span className="error-icon">⚠️</span><span>{error}</span></div>}
        <div className="room-members">
          <p className="room-members-label">참가자 ({room.members?.length || 0}명)</p>
          {(room.members || []).map((m) => (
            <div key={m.user_id} className="room-member-row">
              <span className="room-member-nick">{m.nickname}</span>
              {room.host_user_id === m.user_id && <span className="room-host-badge">호스트</span>}
            </div>
          ))}
        </div>
        <div className="room-lobby-actions">
          {isHost
            ? <button className="btn-primary" onClick={handleStart}>퀴즈 시작</button>
            : <p className="room-wait">호스트가 퀴즈를 시작할 때까지 기다리세요...</p>
          }
          <button className="btn-secondary" onClick={leave}>나가기</button>
        </div>
      </div>
    );
  }

  if (view === "quiz" && room?.questions) {
    return (
      <div>
        <div className="room-quiz-header">
          <span className="room-badge">그룹 스터디</span>
          {submitted
            ? <span className="room-submitted">제출 완료 — 호스트가 종료할 때까지 기다리세요</span>
            : null
          }
          {isHost && <button className="btn-secondary room-finish-btn" onClick={handleFinish}>결과 보기</button>}
        </div>
        {error && <div className="error-banner"><span className="error-icon">⚠️</span><span>{error}</span></div>}
        {room.questions.map((q) => (
          <div key={q.id} className="question-item" style={{ opacity: submitted ? 0.6 : 1 }}>
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
              {submitting ? <><div className="spinner spinner-sm" /> 제출 중...</> : "제출하기"}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (view === "result") {
    const sorted = [...(room.members || [])].sort((a, b) => {
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
              {m.score != null ? `${m.score}/${m.total}` : "미제출"}
            </span>
          </div>
        ))}
        <button className="btn-secondary" style={{ marginTop: 16 }} onClick={leave}>홈으로</button>
      </div>
    );
  }

  return (
    <div className="loading-wrap">
      <div className="spinner" />
      <span className="loading-text">대기 중...</span>
    </div>
  );
}
