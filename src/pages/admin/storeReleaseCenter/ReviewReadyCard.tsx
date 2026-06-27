// Read-only Review-Ready card for the Store Release Center.
// Surfaces the latest deterministic REVIEW.READY.GATE.OS.1 projection per manifest.
// No publish buttons. Only "re-evaluate" action.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { REVIEW_STATE_LABEL, REVIEW_STATE_TONE } from "@/lib/storeReviewReady/status";
import type { ReviewState, ReviewBlocker, ReviewWarning, NextAction } from "@/lib/storeReviewReady/contracts";

type GateRow = {
  id: string;
  manifest_id: string;
  review_state: ReviewState;
  review_score: number;
  blockers: ReviewBlocker[];
  warnings: ReviewWarning[];
  next_actions: NextAction[];
  android_ready: boolean;
  ios_ready: boolean;
  package_hash: string | null;
  manifest_hash: string | null;
  listing_hash: string | null;
  build_hash: string | null;
  version: number;
  created_at: string;
};

export function ReviewReadyCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["store-review-gate-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_review_gate" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const seen = new Set<string>();
      const latest: GateRow[] = [];
      for (const r of (data ?? []) as unknown as GateRow[]) {
        if (seen.has(r.manifest_id)) continue;
        seen.add(r.manifest_id);
        latest.push(r);
      }
      return latest;
    },
  });

  async function reevaluate(manifest_id: string) {
    setBusy(manifest_id);
    try {
      const { error } = await supabase.functions.invoke("evaluate-store-review-ready", {
        body: { manifest_id },
      });
      if (error) throw error;
      toast.success("Review-Ready neu berechnet.");
      qc.invalidateQueries({ queryKey: ["store-review-gate-latest"] });
    } catch (e) {
      toast.error(`Re-Evaluate fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" /> Review Ready (read-only)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Lade Projektion…</div>
        ) : !rows || rows.length === 0 ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="size-4" />
            Noch keine Review-Ready-Evaluation. Klick "Neu prüfen" auf einer Zeile.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={REVIEW_STATE_TONE[r.review_state]}>
                      {REVIEW_STATE_LABEL[r.review_state]}
                    </Badge>
                    <span className="text-sm font-medium">Score: {r.review_score} / 100</span>
                    <span className="text-xs text-muted-foreground">v{r.version}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      manifest: {r.manifest_id.slice(0, 8)}…
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      {r.android_ready ? <CheckCircle2 className="size-3 text-green-600" /> : <XCircle className="size-3 text-muted-foreground" />}
                      Android
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      {r.ios_ready ? <CheckCircle2 className="size-3 text-green-600" /> : <XCircle className="size-3 text-muted-foreground" />}
                      iOS
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.manifest_id}
                    onClick={() => reevaluate(r.manifest_id)}
                  >
                    <RefreshCw className="size-3 mr-1" /> Neu prüfen
                  </Button>
                </div>

                {r.blockers.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold mb-1 text-destructive">Blocker</div>
                    <ul className="text-xs space-y-0.5">
                      {r.blockers.map((b, i) => (
                        <li key={i}>• <span className="font-mono">{b.code}</span> {b.platform ? `(${b.platform})` : ""} — {b.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {r.warnings.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold mb-1 text-muted-foreground">Warnungen</div>
                    <ul className="text-xs space-y-0.5">
                      {r.warnings.map((w, i) => (
                        <li key={i}>• <span className="font-mono">{w.code}</span> — {w.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {r.next_actions.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1">Nächste Aktionen</div>
                    <ul className="text-xs space-y-0.5">
                      {r.next_actions.map((a, i) => (
                        <li key={i}>→ <span className="font-mono">{a.action}</span>{a.platform ? ` (${a.platform})` : ""} — {a.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
