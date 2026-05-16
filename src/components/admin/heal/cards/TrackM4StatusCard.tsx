import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Mail, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Audit = {
  window_hours: number;
  renewal_reverse: { total_events?: number; suppressed_jobs?: number; last_event_at?: string | null };
  auto_promote: { runs?: number; total_promoted?: number; total_candidates?: number; last_run_at?: string | null };
  owner_digest_emails: { pending_email_digests?: number; delivered_email_digests?: number; failed_email_digests?: number };
};

export function TrackM4StatusCard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["track-m4-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_track_m4_audit", { p_window_hours: 168 });
      if (error) throw error;
      return data as unknown as Audit;
    },
    refetchInterval: 60_000,
  });

  const smoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_smoke_track_m4");
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`M4 Smoke OK — Trigger:${d?.reverse_trigger_installed ? '✓' : '✗'} · Promote:${d?.auto_promote_dry_run?.candidates ?? 0} cand · Flip:${d?.owner_digest_email_flip?.flipped ?? 0}`);
      qc.invalidateQueries({ queryKey: ["track-m4-audit"] });
    },
    onError: (e: any) => toast.error(`Smoke failed: ${e.message}`),
  });

  const flushDigests = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("send-org-owner-digest", { body: { triggered_by: "manual" } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`Digest flush: ${d?.sent ?? 0} sent, ${d?.failed ?? 0} failed, ${d?.processed ?? 0} processed`);
      qc.invalidateQueries({ queryKey: ["track-m4-audit"] });
    },
    onError: (e: any) => toast.error(`Flush failed: ${e.message}`),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Track M4 — Monetization Closure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Renewal-Reverse (7d)</span>
                <Badge variant="outline">{data?.renewal_reverse?.total_events ?? 0} events</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {data?.renewal_reverse?.suppressed_jobs ?? 0} pending warn-jobs supprimiert nach Reactivation/Extension.
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Upsell Auto-Promote (7d)</span>
                <Badge variant="outline">{data?.auto_promote?.total_promoted ?? 0} promoted</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {data?.auto_promote?.runs ?? 0} Läufe · {data?.auto_promote?.total_candidates ?? 0} Kandidaten geprüft (≥0.15 conf, ≥5 sup, ≥1.2 lift).
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Owner-Digest Email-Flush (7d)</span>
                <Badge variant="outline">{data?.owner_digest_emails?.delivered_email_digests ?? 0} delivered</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Pending: {data?.owner_digest_emails?.pending_email_digests ?? 0} · Failed: {data?.owner_digest_emails?.failed_email_digests ?? 0}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => smoke.mutate()} disabled={smoke.isPending}>
            {smoke.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Smoke
          </Button>
          <Button size="sm" variant="outline" onClick={() => flushDigests.mutate()} disabled={flushDigests.isPending}>
            {flushDigests.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Flush Digests
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
