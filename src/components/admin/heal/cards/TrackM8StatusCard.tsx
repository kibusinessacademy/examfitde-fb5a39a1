import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type M8 = {
  published_total: number;
  activated: number;
  eligible: number;
  blocked_no_product: number;
  blocked_no_curriculum: number;
  blocked_no_slug: number;
  blocked_no_stripe_price: number;
  recent_auto_runs: number;
  samples_eligible: Array<{ package_id: string; title: string; slug: string }> | null;
};

export function TrackM8StatusCard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["track-m8-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_track_m8_status");
      if (error) throw error;
      return data as unknown as M8;
    },
    refetchInterval: 60_000,
  });

  const runBackfill = async () => {
    const { data, error } = await supabase.rpc("admin_pricing_activation_backfill", {
      _limit: 200,
      _dry_run: false,
    });
    if (error) { toast.error(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast.success(`M8: ${row?.activated_count ?? 0} aktiviert, ${row?.skipped_count ?? 0} skipped`);
    refetch();
  };

  const cleanSeo = async () => {
    const { data, error } = await supabase.rpc("admin_m8_cancel_seo_dead_end_jobs");
    if (error) { toast.error(error.message); return; }
    toast.success(`M8: ${data ?? 0} SEO_DEAD_END Jobs cancelled`);
    refetch();
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">M8 · Pricing Activation</CardTitle></CardHeader>
        <CardContent className="text-xs text-text-muted">lädt…</CardContent>
      </Card>
    );
  }

  const healthy = data.eligible === 0 && data.blocked_no_stripe_price === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">M8 · Pricing Activation</CardTitle>
        <Badge variant={healthy ? "default" : "destructive"}>
          {healthy ? "OK" : "Drift"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Published" value={data.published_total} />
          <Stat label="Activated" value={data.activated} tone="ok" />
          <Stat label="Eligible (offen)" value={data.eligible} tone={data.eligible ? "warn" : "ok"} />
          <Stat label="Auto-Runs 24h" value={data.recent_auto_runs} />
        </div>
        <div className="grid grid-cols-2 gap-1 text-[11px] text-text-muted">
          <span>no_product: {data.blocked_no_product}</span>
          <span>no_curriculum: {data.blocked_no_curriculum}</span>
          <span>no_slug: {data.blocked_no_slug}</span>
          <span>no_stripe_price: {data.blocked_no_stripe_price}</span>
        </div>
        {data.samples_eligible?.length ? (
          <div className="text-[11px] text-text-muted">
            <div className="mb-1 font-medium text-text-default">Eligible Samples</div>
            {data.samples_eligible.slice(0, 5).map((s) => (
              <div key={s.package_id} className="truncate">· {s.title} <span className="opacity-60">/{s.slug}</span></div>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={runBackfill}>Backfill aktivieren</Button>
          <Button size="sm" variant="ghost" onClick={cleanSeo}>SEO Dead-End heilen</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const cls =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-text-default";
  return (
    <div className="flex flex-col">
      <span className="text-text-muted">{label}</span>
      <span className={`text-base font-semibold ${cls}`}>{value}</span>
    </div>
  );
}
