import { cn } from "@/lib/utils";
import { DocIcon, NoteIcon, TableIcon, ImageIcon, PaperclipIcon } from "../Icons.jsx";

const EXT_ICON = {
  pdf: <DocIcon size="1.2em" />,
  doc: <NoteIcon size="1.2em" />, docx: <NoteIcon size="1.2em" />,
  xlsx: <TableIcon size="1.2em" />, csv: <TableIcon size="1.2em" />,
  png: <ImageIcon size="1.2em" />, jpg: <ImageIcon size="1.2em" />, jpeg: <ImageIcon size="1.2em" />,
};

const fallback = <PaperclipIcon size="1.2em" />;

export function FileThumbnail({ file, previewImageUrl, className }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const icon = EXT_ICON[ext] ?? fallback;

  return (
    <div className={cn("flex items-center justify-center bg-gray-100", className)}>
      {previewImageUrl
        ? <img src={previewImageUrl} alt={file.name} className="w-full h-full object-cover rounded-lg" />
        : <span>{icon}</span>
      }
    </div>
  );
}
