import * as React from "react";
import {
  FileImageIcon,
  FileSpreadsheetIcon,
  FileUploadIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BorderBeam } from "border-beam";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { FileThumbnail } from "@/components/ui/file-thumbnail";

const ACCEPTED_FILE_TYPES = [
  { label: "Image", icon: FileImageIcon },
  { label: "PDF", icon: FileUploadIcon },
  { label: "Sheet", icon: FileSpreadsheetIcon },
];

const DEFAULT_ACCEPT = [
  ".pdf",
  "application/pdf",
].join(",");

const ICON_TRANSFORMS = [
  {
    idle: "translate(-78%, -50%) rotate(-8deg)",
    active: "translate(-114%, -50%) rotate(-12deg) scale(1.08)",
  },
  {
    idle: "translate(-50%, -50%) rotate(0deg)",
    active: "translate(-50%, -50%) rotate(0deg) scale(1.18)",
  },
  {
    idle: "translate(-22%, -50%) rotate(8deg)",
    active: "translate(14%, -50%) rotate(12deg) scale(1.08)",
  },
];

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function matchesAccept(file, accept) {
  if (!accept) return true;
  return accept.split(",").some((rawToken) => {
    const token = rawToken.trim().toLowerCase();
    if (!token) return false;
    if (token.startsWith(".")) return file.name.toLowerCase().endsWith(token);
    if (token.endsWith("/*")) return file.type.toLowerCase().startsWith(token.slice(0, -1));
    return file.type.toLowerCase() === token;
  });
}

function toUploadItems(files) {
  return Array.from(files).map((file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    type: file.type || "Unknown type",
    size: file.size,
    url: URL.createObjectURL(file),
  }));
}

function UploadIconCluster({ acceptedFileTypes, isDragging }) {
  const singleIcon = acceptedFileTypes.length === 1;
  return (
    <div className="relative h-14 w-36">
      {acceptedFileTypes.map((item, index) => (
        <Card
          key={item.label}
          className={cn(
            "absolute top-1/2 left-1/2 grid size-12 place-items-center rounded-xl text-slate-500 transition-[transform,color,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            isDragging && "text-slate-900 shadow-md shadow-black/10",
            index === 1 && "z-10",
          )}
          style={{
            transform: singleIcon
              ? `translate(-50%, -50%) scale(${isDragging ? 1.14 : 1})`
              : isDragging
              ? ICON_TRANSFORMS[index]?.active
              : ICON_TRANSFORMS[index]?.idle,
          }}
        >
          <HugeiconsIcon icon={item.icon} className="size-5" />
        </Card>
      ))}
    </div>
  );
}

export function FileUpload({
  accept = DEFAULT_ACCEPT,
  acceptedFileTypes = ACCEPTED_FILE_TYPES,
  browseLabel = "파일 선택",
  className,
  description = "PDF 파일 (최대 50MB)",
  draggingLabel = "여기에 놓으세요",
  multiple = false,
  showBorderBeam = true,
  showFileList = true,
  title = "클릭하거나 파일을 드래그해 업로드",
  onFilesAccepted,
  onFilesChange,
}) {
  const dragDepthRef = React.useRef(0);
  const inputRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [files, setFiles] = React.useState([]);
  const [rejectionMessage, setRejectionMessage] = React.useState(null);

  const commitFiles = React.useCallback(
    (nextFiles) => {
      const acceptedFiles = Array.from(nextFiles)
        .filter((file) => matchesAccept(file, accept))
        .slice(0, multiple ? undefined : 1);

      if (acceptedFiles.length === 0) {
        setRejectionMessage("이 파일 형식은 지원되지 않습니다.");
        return;
      }

      setRejectionMessage(null);
      onFilesAccepted?.(acceptedFiles);

      const items = toUploadItems(acceptedFiles);
      setFiles((prev) => {
        prev.forEach((f) => URL.revokeObjectURL(f.url));
        return items;
      });
      onFilesChange?.(items);
    },
    [accept, multiple, onFilesAccepted, onFilesChange],
  );

  React.useEffect(() => {
    return () => { files.forEach((f) => URL.revokeObjectURL(f.url)); };
  }, [files]);

  const openFileDialog = React.useCallback(() => { inputRef.current?.click(); }, []);

  const dropzone = (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-5 overflow-hidden rounded-[1.125rem] border border-dashed px-6 py-10 text-center transition-[border-color,background-color] duration-200 ease-out",
        isDragging
          ? "border-indigo-400 bg-indigo-50/60"
          : "border-slate-300 hover:border-slate-400 hover:bg-slate-50/40",
      )}
      style={{ backgroundColor: isDragging ? undefined : "white" }}
      onClick={openFileDialog}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) commitFiles(e.dataTransfer.files);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFileDialog(); }
      }}
    >
      <UploadIconCluster acceptedFileTypes={acceptedFileTypes} isDragging={isDragging} />
      <div className="space-y-1">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <div className="text-xs text-slate-400">{description}</div>
        {rejectionMessage && (
          <div className="text-xs text-red-500">{rejectionMessage}</div>
        )}
      </div>
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm">
        <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
        <span>{isDragging ? draggingLabel : browseLabel}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            commitFiles(e.target.files);
            e.currentTarget.value = "";
          }
        }}
      />
    </div>
  );

  return (
    <div className={cn("space-y-3", className)}>
      {showBorderBeam ? (
        <BorderBeam
          active={isDragging}
          borderRadius={18}
          className="rounded-[1.125rem]"
          colorVariant="ocean"
          duration={2.4}
          size="md"
          strength={0.8}
          theme="light"
        >
          {dropzone}
        </BorderBeam>
      ) : (
        dropzone
      )}
      {showFileList && files.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
            >
              <FileThumbnail
                file={{ name: file.name, type: file.type }}
                previewImageUrl={file.type.startsWith("image/") ? file.url : null}
                className="size-10 shrink-0 rounded-lg"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{file.name}</div>
                <div className="truncate text-xs text-slate-400">{formatBytes(file.size)}</div>
              </div>
              <div className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-600 font-medium">
                업로드 중
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FileUpload;
