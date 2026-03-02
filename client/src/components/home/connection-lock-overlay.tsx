import { Button } from "@/components/ui/button";

type ConnectionLockOverlayProps = {
  lock: {
    message: string;
    closeCode: number;
    closeReason: string;
  } | null;
  onTakeover: () => void;
  onRetry: () => void;
};

export function ConnectionLockOverlay({ lock, onTakeover, onRetry }: ConnectionLockOverlayProps) {
  if (!lock) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-md border border-border/60 bg-card/95 shadow-xl p-4 flex flex-col gap-3">
        <div className="text-sm font-medium tracking-tight text-foreground">
          Dashboard access locked
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">{lock.message}</div>
        <div className="text-[11px] text-muted-foreground font-mono">
          close code: {lock.closeCode}
          {lock.closeReason ? ` | reason: ${lock.closeReason}` : ""}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={onTakeover}
            data-testid="button-dashboard-lock-takeover"
          >
            Take over this session
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            data-testid="button-dashboard-lock-retry"
          >
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}
