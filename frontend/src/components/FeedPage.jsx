import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { sendBroadcast } from "../realtime/chatBus";
import { HeartIcon, HeartFilledIcon, TrashIcon, UsersIcon } from "./Icons.jsx";

function Avatar({ src, name, size = 36 }) {
  if (src) return <img src={src} alt={name} className="profile-avatar-img" style={{ width: size, height: size }} referrerPolicy="no-referrer" />;
  return (
    <span className="profile-avatar-init" style={{ width: size, height: size, fontSize: size * 0.38 }}>
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

export default function FeedPage({ me, onOpenProfile }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [content, setContent] = useState("");
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const textRef = useRef();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch("/social/feed"),
      apiFetch("/social/friends"),
      apiFetch("/social/friend-requests"),
    ])
      .then(([feed, fr, reqs]) => { setPosts(feed); setFriends(fr); setFriendRequests(reqs); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function submitPost(e) {
    e.preventDefault();
    if (!content.trim()) return;
    setPosting(true);
    try {
      const post = await apiFetch("/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      setPosts(prev => [post, ...prev]);
      setContent("");
    } catch (err) {
      alert(err.message || "게시글을 올릴 수 없어요.");
    } finally { setPosting(false); }
  }

  async function toggleLike(postId) {
    const res = await apiFetch(`/social/posts/${postId}/like`, { method: "POST" });
    setPosts(prev => prev.map(p => p.id !== postId ? p : {
      ...p, liked_by_me: res.liked, likes: p.likes + (res.liked ? 1 : -1),
    }));
  }

  async function deletePost(postId) {
    if (!confirm("이 게시글을 삭제할까요?")) return;
    await apiFetch(`/social/posts/${postId}`, { method: "DELETE" });
    setPosts(prev => prev.filter(p => p.id !== postId));
  }

  async function respondFriendRequest(id, action) {
    await apiFetch(`/social/friend-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setFriendRequests(prev => prev.filter(r => r.id !== id));
    if (action === "accept") {
      const req = friendRequests.find(r => r.id === id);
      if (req) {
        setFriends(prev => [...prev, { uid: req.from_uid, display_name: req.display_name, photo_url: req.photo_url }]);
        sendBroadcast(`inbox:${req.from_uid}`, "friend-accepted", {
          from: me?.displayName || me?.email?.split("@")[0] || "누군가",
          from_uid: me?.uid,
        });
      }
    }
  }

  return (
    <div className="feed-page">
      <div className="feed-main">
        {/* 작성란 */}
        <form className="feed-compose" onSubmit={submitPost}>
          <Avatar src={me?.photoURL} name={me?.displayName || me?.email} size={36} />
          <div className="feed-compose-inner">
            <textarea
              ref={textRef}
              className="feed-compose-input"
              placeholder="오늘 뭘 공부했나요? 공유해보세요"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <div className="feed-compose-footer">
              <span className="feed-compose-count">{content.length}/500</span>
              <button className="btn-primary btn-sm" type="submit" disabled={posting || !content.trim()}>
                {posting ? "올리는 중…" : "게시하기"}
              </button>
            </div>
          </div>
        </form>

        {/* 피드 */}
        {loading ? (
          <div className="loading-wrap"><div className="spinner" /></div>
        ) : posts.length === 0 ? (
          <div className="feed-empty">
            <UsersIcon size="2em" />
            <p>아직 게시글이 없어요.<br />친구를 추가하면 피드가 채워져요.</p>
          </div>
        ) : (
          <div className="feed-list">
            {posts.map(post => (
              <div key={post.id} className="feed-post">
                <div className="feed-post-meta">
                  <button className="feed-post-author-btn" onClick={() => onOpenProfile?.(post.user_id)}>
                    <Avatar src={post.photo_url} name={post.display_name} size={32} />
                    <span className="feed-post-name">{post.display_name}</span>
                  </button>
                  <span className="feed-post-time">{timeAgo(post.created_at)}</span>
                  {post.user_id === me?.uid && (
                    <button className="feed-post-del" title="삭제" onClick={() => deletePost(post.id)}>
                      <TrashIcon size="0.85em" />
                    </button>
                  )}
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
      </div>

      {/* 사이드 패널 */}
      <aside className="feed-sidebar">
        {/* 친구 요청 */}
        {friendRequests.length > 0 && (
          <div className="feed-side-section">
            <h3 className="feed-side-title">친구 요청</h3>
            {friendRequests.map(r => (
              <div key={r.id} className="feed-friend-req">
                <button className="feed-friend-req-info" onClick={() => onOpenProfile?.(r.from_uid)}>
                  <Avatar src={r.photo_url} name={r.display_name} size={32} />
                  <span>{r.display_name}</span>
                </button>
                <div className="feed-friend-req-btns">
                  <button className="btn-sm btn-primary" onClick={() => respondFriendRequest(r.id, "accept")}>수락</button>
                  <button className="btn-sm btn-ghost" onClick={() => respondFriendRequest(r.id, "deny")}>거절</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 친구 목록 */}
        <div className="feed-side-section">
          <h3 className="feed-side-title">친구 {friends.length > 0 ? `(${friends.length})` : ""}</h3>
          {friends.length === 0 ? (
            <p className="feed-side-empty">아직 친구가 없어요</p>
          ) : friends.map(f => (
            <button key={f.uid} className="feed-friend-row" onClick={() => onOpenProfile?.(f.uid)}>
              <Avatar src={f.photo_url} name={f.display_name} size={28} />
              <span className="feed-friend-name">{f.display_name}</span>
              {f.streak > 0 && <span className="feed-friend-streak">{f.streak}일</span>}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
