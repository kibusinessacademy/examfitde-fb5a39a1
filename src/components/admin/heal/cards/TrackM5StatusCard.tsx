import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MailOpen, MousePointerClick, RefreshCw, Sparkles, AlertOctagon } from "lucide-react";
import { toast } from "sonner";

type M5Audit = {
  window_hours: number;
  digest_tracking: {
    open_events?: number;
    click_events?: number;
    unique_open_recipients?: number;
    unique_click_recipients?: number;
  };
  auto_promote_v2: { runs?: number; total_promoted?: number };
  renewal_re_emit: { events?: number; jobs_emitted?: number };
};

export function TrackM5StatusCard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["track-m5-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_track_m5_audit", { p_window_hours: 168 });
      if (error) throw error;
      return data as unknown as M5Audit;
    },
    refetchInterval: 60_000,
  });

  const smoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_smoke_track_m5");
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      toast.success(
        `M5 Smoke ${d?.ok ? "OK" : "FAIL"} — Tuning:${d?.tuning_default_exists ? "✓" : "✗"} · Trigger:${d?.reemit_trigger_installed ? "✓" : "✗"} · Token:${d?.tracking_token_column ? "✓" : "✗"}`
      );
      qc.invalidateQueries({ queryKey: ["track-m5-audit"] });
    },
    onError: (e: any) => toast.error(`Smoke failed: ${e.message}`),
  });

  const runPromoteV2 = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_auto_promote_upsell_suggestions_v2" as any);
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      toast.success(`Auto-Promote v2: ${d?.total_promoted ?? 0} promoted / ${d?.total_candidates ?? 0} candidates`);
      qc.invalidateQueries({ queryKey: ["track-m5-audit"] });
    },
    onError: (e: any) => toast.error(`Auto-Promote v2 failed: ${e.message}`),
  });

  const tr = data?.digest_tracking;
  const openRate = tr?.unique_open_recipients ?? 0;
  const clickRate = tr?.unique_click_recipients ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Track M5 — Monetization Closure v2
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <MailOpen className="h-3.5 w-3.5" /> Digest Open-Tracking (7d)
                </span>
                <Badge variant="outline">{tr?.open_events ?? 0} opens</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {openRate} unique recipients öffneten · {tr?.click_events ?? 0} Clicks von {clickRate} Recipients
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <MousePointerClick className="h-3.5 w-3.5" /> Auto-Promote v2 / Persona (7d)
                </span>
                <Badge variant="outline">{data?.auto_promote_v2?.total_promoted ?? 0} promoted</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {data?.auto_promote_v2?.runs ?? 0} Runs (cron Mo 04:55) · konfigurierbar via{" "}
                <code className="text-xs">curriculum_upsell_promote_tuning</code>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <AlertOctagon className="h-3.5 w-3.5" /> Renewal Re-Emit (7d)
                </span>
                <Badge variant="outline">{data?.renewal_re_emit?.events ?? 0} events</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {data?.renewal_re_emit?.jobs_emitted ?? 0} frische Warn-Jobs nach Re-Cancel innerhalb 30d post-reverse.
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => smoke.mutate()} disabled={smoke.isPending}>
            {smoke.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Smoke
          </Button>
          <Button size="sm" variant="outline" onClick={() => runPromoteV2.mutate()} disabled={runPromoteV2.isPending}>
            {runPromoteV2.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Run Promote v2
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
