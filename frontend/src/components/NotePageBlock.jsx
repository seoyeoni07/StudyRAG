import { useSyncExternalStore } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { NoteIcon, DocIcon } from "./Icons.jsx";

/*
 * 노트 안의 노트 (노션의 페이지 블록).
 * 본문에서 "/노트"로 하위 노트를 만들면 이 블록이 들어가고, 누르면 그 노트로 이동한다.
 * 제목·아이콘은 앱의 노트 목록에서 실시간으로 읽는다 (이름을 바꿔도 블록에 바로 반영).
 */

// 지금 열린 에디터가 쓰는 동작 (한 번에 노트 하나만 열린다)
let current = { open: () => {}, lookup: () => undefined };
const listeners = new Set();
export function setNotePageActions(next) {
  current = next;
  listeners.forEach(l => l());
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const useActions = () => useSyncExternalStore(subscribe, () => current);

function NotePageView({ block }) {
  const { open, lookup } = useActions();
  const { noteId, title, icon } = block.props;
  const live = lookup(noteId);
  const gone = live === null; // 목록을 아는데 없는 노트 = 삭제됨
  return (
    <div className={`np-block ${gone ? "np-block--gone" : ""}`} contentEditable={false}
      role="button" tabIndex={0} title={gone ? "삭제된 노트" : "노트 열기"}
      onClick={() => !gone && open(noteId)}
      onKeyDown={e => { if (e.key === "Enter" && !gone) open(noteId); }}>
      <span className="np-icon">{live?.icon || icon || <NoteIcon size="0.9em" />}</span>
      <span className="np-title">{gone ? "삭제된 노트" : (live?.title || title || "제목 없음")}</span>
    </div>
  );
}

const NotePage = createReactBlockSpec(
  {
    type: "notePage",
    propSchema: { noteId: { default: "" }, title: { default: "" }, icon: { default: "" } },
    content: "none",
  },
  {
    render: ({ block }) => <NotePageView block={block} />,
    // 검색용 마크다운 변환 때는 제목만 남긴다
    toExternalHTML: ({ block }) => <p>{block.props.title || "노트"}</p>,
  },
);

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, notePage: NotePage() },
});

/** "/" 메뉴의 '노트' 항목 — 하위 노트를 만들고 지금 줄에 블록으로 넣는다 */
export function notePageSlashItem(editor, create) {
  return {
    title: "노트",
    subtext: "이 노트 안에 하위 노트 만들기",
    aliases: ["노트", "페이지", "하위", "note", "page", "subpage"],
    group: "페이지",
    icon: <span style={{ fontSize: 16 }}><DocIcon size="1em" /></span>,
    onItemClick: async () => {
      const n = await create();
      if (!n) return;
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "notePage",
        props: { noteId: n.id, title: n.title || "", icon: n.icon || "" },
      });
    },
  };
}
