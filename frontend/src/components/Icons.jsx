/**
 * Icons — inline SVG, MIT-equivalent paths (Heroicons v2 outline + Feather)
 * size defaults to "1em" so they scale with surrounding font-size.
 * stroke="currentColor" so they inherit CSS color tokens.
 */
const svg = (d, opts = {}) => function Icon({ size = "1em", className = "", style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={opts.filled ? "currentColor" : "none"}
      stroke={opts.filled ? "none" : "currentColor"}
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true"
    >{d}</svg>
  );
};

export const DocIcon = svg(
  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
);
export const NoteIcon = svg(
  <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></>
);
export const LockIcon = svg(
  <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>
);
export const GlobeIcon = svg(
  <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" /></>
);
export const UsersIcon = svg(
  <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></>
);
export const PencilIcon = svg(
  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
);
export const CopyIcon = svg(
  <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>
);
export const TrashIcon = svg(
  <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2" /></>
);
export const LinkIcon = svg(
  <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></>
);
export const PaperclipIcon = svg(
  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
);
export const StarIcon = svg(
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
);
export const StarFilledIcon = svg(
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  { filled: true }
);
export const ThumbUpIcon = svg(
  <><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z" /><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" /></>
);
export const ThumbDownIcon = svg(
  <><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z" /><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" /></>
);
export const CalendarIcon = svg(
  <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>
);
export const SparkleIcon = svg(
  <><path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /><circle cx="12" cy="12" r="3" /></>
);
export const ChatIcon = svg(
  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
);
export const CameraIcon = svg(
  <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></>
);
export const ImageIcon = svg(
  <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>
);
export const TableIcon = svg(
  <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>
);
export const ArrowUpIcon = svg(
  <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>
);
export const WarningIcon = svg(
  <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
);
export const SpinnerIcon = svg(
  <><path d="M21 12a9 9 0 11-6.22-8.56" /></>
);
export const BookIcon = svg(
  <><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>
);
export const BookmarkIcon = svg(
  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
);
export const BulbIcon = svg(
  <><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/></>
);
export const PinIcon = svg(
  <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></>
);
export const TargetIcon = svg(
  <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>
);
export const HashIcon = svg(
  <><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>
);
export const ClockIcon = svg(
  <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>
);

/** 노트 아이콘 픽커 옵션 목록 */
export const ICON_DEFS = [
  { key: "note",     Comp: NoteIcon,      label: "노트" },
  { key: "book",     Comp: BookIcon,      label: "책" },
  { key: "doc",      Comp: DocIcon,       label: "문서" },
  { key: "star",     Comp: StarFilledIcon,label: "별" },
  { key: "bookmark", Comp: BookmarkIcon,  label: "책갈피" },
  { key: "bulb",     Comp: BulbIcon,      label: "아이디어" },
  { key: "pin",      Comp: PinIcon,       label: "핀" },
  { key: "pencil",   Comp: PencilIcon,    label: "필기" },
  { key: "target",   Comp: TargetIcon,    label: "목표" },
  { key: "hash",     Comp: HashIcon,      label: "주제" },
  { key: "clock",    Comp: ClockIcon,     label: "일정" },
  { key: "sparkle",  Comp: SparkleIcon,   label: "핵심" },
];

/**
 * 아이콘 키 → JSX 변환 헬퍼.
 * - "note", "star" 등 키 문자열 → SVG 컴포넌트
 * - "📝", "⭐" 등 이모지 문자열 → 그대로 반환 (레거시 데이터 호환)
 * - null/undefined/"" → null
 */
export function renderNoteIcon(key, size = "0.9em") {
  if (!key) return null;
  const found = ICON_DEFS.find(d => d.key === key);
  if (found) return <found.Comp size={size} />;
  return key;
}
