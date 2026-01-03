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
      <div className="flex items-center gap-4 p-4 bg-card border border-card-border rounded-md">
        <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-md">
          <CheckCircle2 className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate" data-testid="text-filename">
              {uploadedFile.name}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>{formatFileSize(uploadedFile.size)}</span>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
            <span className="font-mono" data-testid="text-tick-count">
              {uploadedFile.tickCount.toLocaleString()} ticks
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          data-testid="button-clear-file"
          aria-label="Clear uploaded file"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-4 p-4 bg-destructive/10 border border-destructive/20 rounded-md">
        <div className="flex items-center justify-center w-10 h-10 bg-destructive/20 rounded-md">
          <AlertCircle className="w-5 h-5 text-destructive" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm text-destructive">Upload Failed</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          data-testid="button-clear-error"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center h-48 border-2 border-dashed rounded-md transition-all cursor-pointer",
        isDragging
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-muted-foreground/30 hover:border-muted-foreground/50",
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
        disabled={isUploading}
        data-testid="input-file-upload"
        aria-label="Upload JSONL capture file"
      />
      <div className="flex flex-col items-center gap-3 p-4 pointer-events-none">
        <div className="flex items-center justify-center w-12 h-12 bg-muted rounded-full">
          <Upload className={cn("w-6 h-6 text-muted-foreground", isUploading && "animate-pulse")} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {isUploading ? "Uploading..." : "Drop your capture file here"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {isUploading ? "Parsing file contents" : "or click to browse (.jsonl files)"}
          </p>
        </div>
      </div>
    </div>
  );
}
