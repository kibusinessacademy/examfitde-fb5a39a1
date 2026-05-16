import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, RefreshCw, Link2, Settings2 } from "lucide-react";
import { toast } from "sonner";

type M7Audit = {
  window_hours: number;
  reverse_paid_suppressed_count: number;
  renewal_links_total: number;
  renewal_links_active: number;
  paywall_jobs_with_variant: number;
  paywall_jobs_without_variant: number;
  digest_prefs_weekly: number;
  digest_prefs_monthly: number;
  digest_prefs_disabled: number;
};

export function TrackM7StatusCard() {
  const { data: audit, isLoading, refetch } = useQuery({
    queryKey: ["track-m7-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_track_m7_audit", { p_window_hours: 168 });
      if (error) throw error;
      return data as unknown as M7Audit;
    },
    refetchInterval: 60_000,
  });

  const smoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_smoke_track_m7");
      if (error) throw error;
      return data as Record<string, boolean>;
    },
    onSuccess: (data) => {
      const allGreen = Object.values(data).every(Boolean);
      if (allGreen) toast.success("M7 smoke: all green");
      else toast.warning(`M7 smoke: ${JSON.stringify(data)}`);
    },
    onError: (e: any) => toast.error(`Smoke failed: ${e.message}`),
  });

  const totalPaywall = (audit?.paywall_jobs_with_variant ?? 0) + (audit?.paywall_jobs_without_variant ?? 0);
  const variantCoverage = totalPaywall > 0
    ? Math.round((100 * (audit?.paywall_jobs_with_variant ?? 0)) / totalPaywall)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Track M7 — Monetization Closure v4
          <Badge variant="outline" className="ml-2">7d</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Metric
              label="Paid-Reverse suppr."
              value={audit?.reverse_paid_suppressed_count ?? 0}
              hint="checkout_abandoned jobs auto-suppressed on payment"
            />
            <Metric
              label="Renewal links active"
              value={`${audit?.renewal_links_active ?? 0} / ${audit?.renewal_links_total ?? 0}`}
              hint="self-service org renewal tokens"
              icon={<Link2 className="h-3 w-3" />}
            />
            <Metric
              label="Paywall variant cov."
              value={variantCoverage !== null ? `${variantCoverage}%` : "—"}
              hint={`${audit?.paywall_jobs_with_variant ?? 0} stamped / ${audit?.paywall_jobs_without_variant ?? 0} missing`}
              status={
                variantCoverage === null ? "neutral"
                  : variantCoverage >= 95 ? "ok"
                  : variantCoverage >= 70 ? "warn" : "fail"
              }
            />
            <Metric
              label="Digest prefs"
              value={`${audit?.digest_prefs_weekly ?? 0}w/${audit?.digest_prefs_monthly ?? 0}m/${audit?.digest_prefs_disabled ?? 0}off`}
              hint="weekly / monthly / disabled"
              icon={<Settings2 className="h-3 w-3" />}
            />
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => smoke.mutate()} disabled={smoke.isPending}>
            {smoke.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
            Run Smoke
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label, value, hint, icon, status = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  status?: "ok" | "warn" | "fail" | "neutral";
}) {
  const tone =
    status === "ok" ? "text-emerald-600"
    : status === "warn" ? "text-amber-600"
    : status === "fail" ? "text-destructive"
    : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
