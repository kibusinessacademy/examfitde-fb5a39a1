/**
 * ContextSensitiveHealActions v8.3
 * ────────────────────────────────
 * Reine Präsentationskomponente. Keine eigenen Heal-Calls mehr.
 * Mappt release_class → semantische Buttons, ruft Callbacks vom Parent auf.
 *
 * Parent verwendet usePackageHealAction (SSOT-Hook) für die Ausführung.
 */
import { Button } from "@/components/ui/button";
import { Loader2, Rocket, GitMerge, OctagonAlert, Wrench } from "lucide-react";
import type { ReleaseClass } from "@/features/admin/api/releaseClassificationApi";

interface Props {
  releaseClass?: ReleaseClass | null;
  busy: boolean;
  /** Soft heal → reset_to_step('auto_publish') (release_ok) */
  onSoftPublish?: () => void;
  /** Hard heal + targeted repair (release_warn / release_block / unknown) */
  onHardHeal: () => void;
  /** Mark content_gap (release_warn / release_block escalation) */
  onMarkContentGap: () => void;
}

export function ContextSensitiveHealActions({
  releaseClass,
  busy,
  onSoftPublish,
  onHardHeal,
  onMarkContentGap,
}: Props) {
  const Spin = () => <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />;

  if (releaseClass === "release_ok") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={busy || !onSoftPublish} onClick={onSoftPublish}>
          {busy ? <Spin /> : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
          Soft Reentry → Publish
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onHardHeal}>
          {busy ? <Spin /> : <Wrench className="h-3.5 w-3.5 mr-1.5" />}
          Hard Heal
        </Button>
      </div>
    );
  }

  if (releaseClass === "release_warn") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={busy} onClick={onHardHeal}>
          {busy ? <Spin /> : <GitMerge className="h-3.5 w-3.5 mr-1.5" />}
          Hard Heal + Repair
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
        <Button size="sm" variant="outline" disabled={busy} onClick={onHardHeal}>
          {busy ? <Spin /> : <Wrench className="h-3.5 w-3.5 mr-1.5" />}
          Hard Heal (kein Publish)
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
      <Button size="sm" variant="outline" disabled={busy || !onSoftPublish} onClick={onSoftPublish}>
        Soft Reentry
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onHardHeal}>
        Hard Heal
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
