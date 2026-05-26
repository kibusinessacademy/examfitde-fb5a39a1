/**
 * P71 — Artifact Preview Drawer
 *
 * Customer-grade preview surface for a single background task's artifact.
 * Pure read-only: consumes a pre-loaded TaskRow (already fetched via the
 * P70.1 admin RPC) and projects it via the deterministic resolver.
 *
 * NO direct table reads. NO mutations. NO new RPC.
 */
import { useMemo } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Copy, Download, FileJson, FileText, Inbox, ShieldCheck, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";
import {
  buildArtifactPreview,
  buildEvidenceChain,
  exportArtifactAsJson,
  exportArtifactAsMarkdown,
  type EvidenceStep,
} from "@/lib/governance/backgroundAgentArtifacts";

const EVIDENCE_TONE: Record<EvidenceStep["kind"], string> = {
  source: "bg-surface-muted text-fg-muted",
  action: "bg-status-bg-subtle-info text-status-fg-info",
  artifact: "bg-status-bg-subtle-success text-status-fg-success",
  audit: "bg-status-bg-subtle-warning text-status-fg-warning",
};

interface Props {
  task: BackgroundTaskLike | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArtifactPreviewDrawer({ task, open, onOpenChange }: Props) {
  const { toast } = useToast();

  const preview = useMemo(() => (task ? buildArtifactPreview(task) : null), [task]);
  const chain = useMemo(() => (task ? buildEvidenceChain(task) : []), [task]);

  async function copyTo(format: "json" | "markdown") {
    if (!task || !preview) return;
    const text =
      format === "json"
        ? exportArtifactAsJson(preview, task)
        : exportArtifactAsMarkdown(preview, task);
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "In Zwischenablage kopiert", description: `Format: ${format.toUpperCase()}` });
    } catch {
      toast({ title: "Kopieren fehlgeschlagen", variant: "destructive" });
    }
  }

  function downloadAs(format: "json" | "markdown") {
    if (!task || !preview) return;
    const text =
      format === "json"
        ? exportArtifactAsJson(preview, task)
        : exportArtifactAsMarkdown(preview, task);
    const blob = new Blob([text], {
      type: format === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `artifact-${task.source_type}-${task.source_id}.${format === "json" ? "json" : "md"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="artifact-preview-drawer">
        {!task || !preview ? (
          <div className="p-6 text-center text-fg-muted text-sm">Kein Artefakt ausgewählt.</div>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-fg-muted" />
                <Badge variant="outline" className="text-[10px] uppercase">
                  {preview.descriptor.label}
                </Badge>
              </div>
              <SheetTitle className="text-lg">{preview.title}</SheetTitle>
              <SheetDescription>{preview.summary}</SheetDescription>
            </SheetHeader>

            {/* Export / Copy bar */}
            <div className="flex flex-wrap gap-2 mt-4" data-testid="artifact-export-bar">
              <Button size="sm" variant="outline" onClick={() => void copyTo("markdown")}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Markdown kopieren
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyTo("json")}>
                <FileJson className="h-3.5 w-3.5 mr-1.5" />
                JSON kopieren
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadAs("markdown")}>
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                .md
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadAs("json")}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                .json
              </Button>
            </div>

            <Separator className="my-4" />

            {/* Body */}
            {preview.isEmpty ? (
              <div
                className="rounded-md border border-dashed border-border bg-surface-muted/40 p-6 text-center"
                data-testid="artifact-empty-state"
              >
                <Inbox className="h-6 w-6 mx-auto text-fg-muted mb-2" />
                <div className="text-sm font-medium">Workflow gestartet</div>
                <div className="text-xs text-fg-muted mt-1">
                  Das Ergebnis erscheint hier, sobald der Workflow abgeschlossen ist.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {preview.sections.map((s) => (
                  <section key={s.heading}>
                    <div className="text-xs uppercase tracking-wide text-fg-muted mb-1">{s.heading}</div>
                    {Array.isArray(s.body) ? (
                      <ul className="list-disc list-inside text-sm space-y-1">
                        {s.body.map((b, i) => (
                          <li key={i} className="text-fg">{b}</li>
                        ))}
                      </ul>
                    ) : (
                      <pre className="whitespace-pre-wrap text-xs font-mono bg-surface-muted/40 rounded p-2 max-h-60 overflow-auto">
                        {s.body}
                      </pre>
                    )}
                  </section>
                ))}
              </div>
            )}

            {/* Evidence Chain */}
            <Separator className="my-4" />
            <section data-testid="artifact-evidence-chain">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-4 w-4 text-fg-muted" />
                <h3 className="text-sm font-semibold">Evidence Chain</h3>
              </div>
              <div className="text-[11px] text-fg-muted mb-3">
                source → action → artifact → audit
              </div>
              <ol className="space-y-2">
                {chain.map((step, i) => (
                  <li key={`${step.kind}-${i}`} className="flex items-start gap-3">
                    <Badge className={`${EVIDENCE_TONE[step.kind]} text-[10px] uppercase shrink-0 mt-0.5`}>
                      {step.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm break-words">{step.detail}</div>
                      {step.reference && (
                        <div className="text-[11px] font-mono text-fg-muted truncate">{step.reference}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
