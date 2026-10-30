import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function PublicNotePage({ note, onLogin }) {
  return (
    <div className="pub-note-root">
      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <div className="login-mark">SR</div>
          <span className="lp-brand-name">StudyRAG</span>
        </div>
        <button className="btn-primary" style={{ fontSize: 13, padding: "6px 16px" }} onClick={onLogin}>
          로그인하기
        </button>
      </nav>

      <div className="pub-note-body">
        <h1 className="pub-note-title">{note.title || "제목 없음"}</h1>

        {note.content ? (
          <div className="pub-note-content">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {note.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="pub-note-empty">
            <p>로그인하면 내용을 볼 수 있어요.</p>
            <button className="btn-primary" style={{ marginTop: 16 }} onClick={onLogin}>로그인하기</button>
          </div>
        )}
      </div>
    </div>
  );
}
