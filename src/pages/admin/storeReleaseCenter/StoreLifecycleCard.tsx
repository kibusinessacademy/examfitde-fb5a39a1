// STORE.LIFECYCLE.OS.1 — Admin Card
// Read-only lifecycle projection + manual feedback entry.
// NO publish/submit/rollout buttons.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Activity, AlertTriangle } from "lucide-react";

type Props = { manifestId: string | null };

const FEEDBACK_TYPES = [
  "apple_metadata_rejected",
  "apple_binary_rejected",
  "apple_approved",
  "apple_waiting_for_review",
  "apple_in_review",
  "google_metadata_rejected",
  "google_policy_rejected",
  "google_approved",
  "google_in_review",
  "google_action_required",
  "manual_note",
  "unknown",
] as const;

const RISK_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline",
  moderate: "secondary",
  elevated: "default",
  high: "destructive",
};

export function StoreLifecycleCard({ manifestId }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<"apple" | "google">("apple");
  const [type, setType] = useState<string>("apple_in_review");
  const [summary, setSummary] = useState("");
  const [externalRef, setExternalRef] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["store-lifecycle-projection", manifestId],
    enabled: !!manifestId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("project-store-lifecycle", {
        body: { manifest_id: manifestId },
      });
      if (error) throw error;
      return data as any;
    },
  });

  async function submitFeedback() {
    if (!manifestId || !data?.projection?.current_candidate_id) {
      toast.error("Kein aktiver Release-Candidate vorhanden.");
      return;
    }
    if (!summary.trim()) {
      toast.error("Bitte Zusammenfassung eintragen.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("record-store-feedback", {
        body: {
          candidate_id: data.projection.current_candidate_id,
          manifest_id: manifestId,
          platform,
          store_feedback_type: type,
          store_feedback_status: /rejected|action_required/.test(type)
            ? "blocking"
            : type.endsWith("approved") ? "approved" : "informational",
          external_reference: externalRef || null,
          reason_code: null,
          human_summary: summary.trim(),
          required_action: null,
          received_at_reference: new Date().toISOString(),
          evidence_url: null,
          reviewer: null,
          payload_hash: null,
          current_state: data.projection.lifecycle_state,
        },
      });
      if (error) throw error;
      toast.success("Store-Feedback erfasst.");
      setSummary("");
      setExternalRef("");
      qc.invalidateQueries({ queryKey: ["store-lifecycle-projection", manifestId] });
      refetch();
    } catch (e: any) {
      toast.error(`Erfassung fehlgeschlagen: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  if (!manifestId) return null;

  const p = data?.projection;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" /> Store Lifecycle
          {p && <Badge variant={RISK_BADGE[p.risk_level] ?? "outline"}>Risk: {p.risk_level}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !p ? (
          <p className="text-sm text-muted-foreground">Lade Projection…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div><div className="text-muted-foreground">State</div><Badge>{p.lifecycle_state}</Badge></div>
              <div><div className="text-muted-foreground">Apple</div>
                <Badge variant="outline">{p.platform_state.apple?.state ?? "—"}</Badge>
              </div>
              <div><div className="text-muted-foreground">Google</div>
                <Badge variant="outline">{p.platform_state.google?.state ?? "—"}</Badge>
              </div>
              <div><div className="text-muted-foreground">Versions</div>
                <code>{p.version_line.join(" ← ") || "—"}</code>
              </div>
            </div>

            {p.blocking_reasons.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center text-xs">
                <AlertTriangle className="size-3 text-destructive" />
                {p.blocking_reasons.map((b: string) => (
                  <Badge key={b} variant="destructive">{b}</Badge>
                ))}
              </div>
            )}
            {p.warnings.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.warnings.map((w: string) => <Badge key={w} variant="secondary">{w}</Badge>)}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Next: {p.recommended_next_actions.join(" · ")} ·
              Rollback: {p.rollback_available ? `available (${p.rollback_candidate_id})` : "no"} ·
              Events: {p.timeline_summary.events}
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="text-sm font-medium">Manuelles Store-Feedback erfassen</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Select value={platform} onValueChange={(v) => setPlatform(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apple">Apple</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="external_reference (optional)"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                />
              </div>
              <Textarea
                placeholder="Human summary (Reviewer-Notiz, Begründung)"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={2}
              />
              <Button size="sm" onClick={submitFeedback} disabled={busy || !p.current_candidate_id}>
                Feedback erfassen
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Dieser Layer veröffentlicht nichts und ruft keine Store-API. Manuelles Logging der externen Review-Realität.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
