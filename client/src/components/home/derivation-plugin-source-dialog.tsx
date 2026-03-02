import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type DerivationPluginSource = {
  pluginId: string;
  name: string;
  bytes: number;
  truncated: boolean;
  source: string;
};

type DerivationPluginSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  source: DerivationPluginSource | null;
  copied: boolean;
  onCopy: () => void;
  formatBytes: (value: number) => string;
};

export function DerivationPluginSourceDialog({
  open,
  onOpenChange,
  loading,
  error,
  source,
  copied,
  onCopy,
  formatBytes,
}: DerivationPluginSourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-3xl h-[80vh] flex flex-col gap-3">
        {loading && <div className="text-xs text-muted-foreground">Loading source...</div>}
        {error && <div className="text-xs text-red-500">{error}</div>}
        {source && (
          <div className="flex flex-col gap-2 flex-1 min-h-0">
            <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
              <span className="truncate">
                {source.name} ({source.pluginId})
              </span>
              <span className="font-mono text-[11px] shrink-0">
                {formatBytes(source.bytes)}
                {source.truncated ? " (truncated)" : ""}
              </span>
            </div>
            <div className="relative flex-1 min-h-0 rounded-md border border-border/50 bg-muted/20 overflow-hidden group/plugin-source">
              <div className="pointer-events-none absolute top-1 right-1 left-auto z-20">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={onCopy}
                  className="pointer-events-auto h-6 w-6 rounded-sm border border-border/50 bg-background/85 text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover/plugin-source:opacity-100 focus-visible:opacity-100"
                  data-hint={copied ? "Plugin source copied" : "Copy plugin source to clipboard"}
                  aria-label="Copy plugin source to clipboard"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <ScrollArea className="h-full">
                <pre className="p-3 text-[11px] leading-relaxed font-mono text-foreground whitespace-pre overflow-x-auto">
                  {source.source}
                </pre>
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
