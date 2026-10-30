import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { sendBroadcast } from "../realtime/chatBus";
import { NoteIcon, renderNoteIcon, HeartIcon, HeartFilledIcon, UserPlusIcon, UserCheckIcon, MessageIcon } from "./Icons.jsx";

function Avatar({ src, name, size = 48 }) {
  if (src) return <img src={src} alt={name} className="profile-avatar-img" style={{ width: size, height: size }} referrerPolicy="no-referrer" />;
  return (
    <span className="profile-avatar-init" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

export default function ProfilePage({ uid, me, onOpenNote, onStartDm }) {
  const [profile, setProfile] = useState(null);
  const [notes, setNotes] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("posts"); // posts | notes

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      apiFetch(`/social/profile/${uid}`),
      apiFetch(`/social/profile/${uid}/notes`),
      apiFetch(`/social/posts/user/${uid}`),
    ])
      .then(([p, n, po]) => { setProfile(p); setNotes(n); setPosts(po); })
      .catch(e => setError(e.message || "프로필을 불러올 수 없어요."))
      .finally(() => setLoading(false));
  }, [uid]);

  async function handleFriendAction() {
    if (!profile) return;
    setFriendBusy(true);
    try {
      const { friendship_status, friendship_id, sent_by_me } = profile;
      if (friendship_status === "none" || (friendship_status === "denied" && sent_by_me)) {
        const res = await apiFetch(`/social/friend-request/${uid}`, { method: "POST" });
        sendBroadcast(`inbox:${uid}`, "friend-request", {
          from: me?.displayName || me?.email?.split("@")[0] || "누군가",
          from_uid: me?.uid,
        });
        setProfile(p => ({ ...p, friendship_status: "pending", friendship_id: res.id, sent_by_me: true }));
      } else if (friendship_status === "accepted") {
        if (!confirm("친구를 삭제할까요?")) return;
        await apiFetch(`/social/friends/${uid}`, { method: "DELETE" });
        setProfile(p => ({ ...p, friendship_status: "none", friendship_id: null, friends_count: Math.max(0, p.friends_count - 1) }));
      } else if (friendship_status === "pending" && !sent_by_me) {
        // incoming request — accept
        await apiFetch(`/social/friend-requests/${friendship_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "accept" }),
        });
        sendBroadcast(`inbox:${uid}`, "friend-accepted", {
          from: me?.displayName || me?.email?.split("@")[0] || "누군가",
          from_uid: me?.uid,
        });
        setProfile(p => ({ ...p, friendship_status: "accepted", friends_count: p.friends_count + 1 }));
      }
    } catch (e) {
      alert(e.message || "오류가 발생했어요.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function toggleLike(postId) {
    const res = await apiFetch(`/social/posts/${postId}/like`, { method: "POST" });
    setPosts(prev => prev.map(p => p.id !== postId ? p : {
      ...p,
      liked_by_me: res.liked,
      likes: p.likes + (res.liked ? 1 : -1),
    }));
  }

  const isMe = me?.uid === uid;

  if (loading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!profile) return null;

  const { friendship_status, sent_by_me } = profile;

  let friendLabel = "친구 추가";
  let FriendIcon = UserPlusIcon;
  if (friendship_status === "accepted") { friendLabel = "친구"; FriendIcon = UserCheckIcon; }
  else if (friendship_status === "pending" && sent_by_me) { friendLabel = "요청 중"; FriendIcon = UserCheckIcon; }
  else if (friendship_status === "pending" && !sent_by_me) { friendLabel = "수락하기"; FriendIcon = UserCheckIcon; }

  return (
    <div className="profile-page">
      {/* 헤더 */}
      <div className="profile-header">
        <Avatar src={profile.photo_url} name={profile.display_name} size={72} />
        <div className="profile-info">
          <h2 className="profile-name">{profile.display_name}</h2>
          <div className="profile-stats">
            <span className="profile-stat">
              <strong>{profile.streak}</strong>일 연속 학습
            </span>
            <span className="profile-stat-sep" />
            <span className="profile-stat">
              <strong>{profile.friends_count}</strong> 친구
            </span>
            <span className="profile-stat-sep" />
            <span className="profile-stat">
              <strong>{profile.public_notes_count}</strong> 공개 노트
            </span>
          </div>
          {!isMe && (
            <div className="profile-actions">
              <button
                className={`btn-sm ${friendship_status === "accepted" ? "btn-ghost" : "btn-primary"} profile-friend-btn`}
                onClick={handleFriendAction}
                disabled={friendBusy || (friendship_status === "pending" && sent_by_me)}
              >
                <FriendIcon size="0.9em" /> {friendLabel}
              </button>
              {onStartDm && (
                <button className="btn-sm btn-ghost profile-dm-btn" onClick={() => onStartDm(uid, profile)}>
                  <MessageIcon size="0.9em" /> 메시지
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="profile-tabs">
        <button className={`profile-tab ${activeTab === "posts" ? "active" : ""}`} onClick={() => setActiveTab("posts")}>게시글</button>
        <button className={`profile-tab ${activeTab === "notes" ? "active" : ""}`} onClick={() => setActiveTab("notes")}>공개 노트</button>
      </div>

      {/* 게시글 */}
      {activeTab === "posts" && (
        posts.length === 0
          ? <p className="profile-empty">아직 게시글이 없어요.</p>
          : <div className="profile-posts">
              {posts.map(post => (
                <div key={post.id} className="feed-post">
                  <div className="feed-post-meta">
                    <Avatar src={post.photo_url} name={post.display_name} size={32} />
                    <span className="feed-post-name">{post.display_name}</span>
                    <span className="feed-post-time">{timeAgo(post.created_at)}</span>
                  </div>
                  <p className="feed-post-content">{post.content}</p>
                  <div className="feed-post-actions">
                    <button className={`feed-like-btn ${post.liked_by_me ? "feed-like-btn--on" : ""}`} onClick={() => toggleLike(post.id)}>
                      {post.liked_by_me ? <HeartFilledIcon size="0.9em" /> : <HeartIcon size="0.9em" />}
                      {post.likes > 0 && <span>{post.likes}</span>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
      )}

      {/* 공개 노트 */}
      {activeTab === "notes" && (
        notes.length === 0
          ? <p className="profile-empty">공개된 노트가 없어요.</p>
          : <div className="profile-notes">
              {notes.map(n => (
                <button key={n.id} className="profile-note-item" onClick={() => onOpenNote?.(n.id)}>
                  <span className="profile-note-icon">{renderNoteIcon(n.icon, "1.1em") || <NoteIcon size="1.1em" />}</span>
                  <span className="profile-note-title">{n.title}</span>
                  <span className="profile-note-time">{timeAgo(n.updated_at)}</span>
                </button>
              ))}
            </div>
      )}
    </div>
  );
}
