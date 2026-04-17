import { Button } from "@/components/ui/button";
import { Loader2, Rocket, GitMerge, OctagonAlert } from "lucide-react";
import type { ReleaseClass } from "@/features/admin/api/releaseClassificationApi";

interface Props {
  releaseClass?: ReleaseClass | null;
  busy: boolean;
  onForcePublish: () => void;
  onReconcile: () => void;
  onMarkContentGap: () => void;
}

/**
 * Renders heal actions depending on release_class:
 *  - release_ok    → primary: Force-Publish
 *  - release_warn  → primary: Reconcile (kann publish wenn Force erlaubt)
 *  - release_block → primary: Reconcile (kein Publish), secondary: Mark content_gap
 *  - unknown       → alle drei sichtbar als Fallback
 */
export function ContextSensitiveHealActions({
  releaseClass,
  busy,
  onForcePublish,
  onReconcile,
  onMarkContentGap,
}: Props) {
  const Spin = () => <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />;

  if (releaseClass === "release_ok") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={busy} onClick={onForcePublish}>
          {busy ? <Spin /> : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
          Force-Publish
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReconcile}>
          {busy ? <Spin /> : <GitMerge className="h-3.5 w-3.5 mr-1.5" />}
          Reconcile (no publish)
        </Button>
      </div>
    );
  }

  if (releaseClass === "release_warn") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={busy} onClick={onReconcile}>
          {busy ? <Spin /> : <GitMerge className="h-3.5 w-3.5 mr-1.5" />}
          Reconcile
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onMarkContentGap}
          className="border-destructive/30 text-destructive hover:bg-destructive/10"
        >
          {busy ? <Spin /> : <OctagonAlert className="h-3.5 w-3.5 mr-1.5" />}
          Mark content_gap
        </Button>
      </div>
    );
  }

  if (releaseClass === "release_block") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={onReconcile}>
          {busy ? <Spin /> : <GitMerge className="h-3.5 w-3.5 mr-1.5" />}
          Reconcile (kein Publish)
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={onMarkContentGap}
          variant="outline"
          className="border-destructive/30 text-destructive hover:bg-destructive/10"
        >
          {busy ? <Spin /> : <OctagonAlert className="h-3.5 w-3.5 mr-1.5" />}
          Mark content_gap
        </Button>
      </div>
    );
  }

  // Unknown class — fallback
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={onForcePublish}>
        Force-Publish
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onReconcile}>
        Reconcile
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={onMarkContentGap}
        className="border-destructive/30 text-destructive"
      >
        content_gap
      </Button>
    </div>
  );
}
