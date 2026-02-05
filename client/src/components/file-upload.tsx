import { useCallback, useState } from "react";
import { Upload, FileText, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  uploadedFile: { name: string; size: number; tickCount: number } | null;
  error: string | null;
  onClear: () => void;
}

export function FileUpload({
  onFileUpload,
  isUploading,
  uploadedFile,
  error,
  onClear,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith(".jsonl")) {
          onFileUpload(file);
        }
      }
    },
    [onFileUpload]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFileUpload(files[0]);
      }
    },
    [onFileUpload]
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (uploadedFile) {
    return (
      <div className="flex items-center gap-3 py-2">
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm truncate" data-testid="text-filename">
          {uploadedFile.name}
        </span>
        <span className="text-xs text-muted-foreground font-mono" data-testid="text-tick-count">
          {uploadedFile.tickCount.toLocaleString()} ticks
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          data-testid="button-clear-file"
          aria-label="Clear uploaded file"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 py-2">
        <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
        <span className="text-sm text-destructive">{error}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          data-testid="button-clear-error"
          aria-label="Dismiss error"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex items-center justify-center gap-2 py-2 px-3 border border-dashed rounded transition-colors cursor-pointer",
        isDragging
          ? "border-foreground bg-muted/50"
          : "border-muted-foreground/20 hover:border-muted-foreground/40",
        isUploading && "pointer-events-none opacity-60"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="dropzone-file-upload"
    >
      <input
        type="file"
        accept=".jsonl"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        style={{ margin: 0, padding: 0 }}
        disabled={isUploading}
        data-testid="input-file-upload"
        aria-label="Upload JSONL capture file"
      />
      <Upload className={cn("w-4 h-4 text-muted-foreground shrink-0", isUploading && "animate-pulse")} />
      <p className="text-xs text-muted-foreground">
        {isUploading ? "Processing..." : "Drop .jsonl or click"}
      </p>
    </div>
  );
}
