import { cn } from "@/lib/utils";

const EXT_ICON = {
  pdf: "📄",
  doc: "📝", docx: "📝",
  xlsx: "📊", csv: "📊",
  png: "🖼", jpg: "🖼", jpeg: "🖼",
};

export function FileThumbnail({ file, previewImageUrl, className }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const icon = EXT_ICON[ext] ?? "📎";

  return (
    <div className={cn("flex items-center justify-center bg-gray-100 text-xl", className)}>
      {previewImageUrl
        ? <img src={previewImageUrl} alt={file.name} className="w-full h-full object-cover rounded-lg" />
        : <span>{icon}</span>
      }
    </div>
  );
}
