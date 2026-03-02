import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type DocsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  content: string;
};

export function DocsDialog({ open, onOpenChange, loading, error, content }: DocsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <span>Documentation</span>
            <a
              href="/USAGE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Raw
              <ExternalLink className="w-3 h-3" />
            </a>
          </DialogTitle>
        </DialogHeader>
        {loading ? <div className="text-xs text-muted-foreground">Loading docs...</div> : null}
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
        <div className="flex-1 min-h-0 rounded-md border border-border/50 bg-muted/20 overflow-hidden">
          <ScrollArea className="h-full">
            <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-foreground">
              {content || "No documentation content loaded."}
            </pre>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
