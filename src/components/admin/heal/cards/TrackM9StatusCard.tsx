import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SummaryRow = {
  track: string;
  total: number;
  sellable: number;
  modules_missing: number;
  lessons_missing: number;
  lessons_not_ready: number;
  content_gap_published_locked: number;
  questions_missing: number;
  pricing_missing: number;
};

export function TrackM9StatusCard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["track-m9-sellability"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_content_sellability_summary" as any,
      );
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    refetchInterval: 60_000,
  });

  const runBackfill = async (dryRun: boolean) => {
    const { data, error } = await supabase.rpc(
      "admin_content_sellability_backfill" as any,
      { p_limit: 10, p_dry_run: dryRun },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as any;
    toast.success(
      `M9 ${dryRun ? "Dry-Run" : "Live"}: dispatched ${res?.dispatched ?? 0}, skipped ${res?.skipped ?? 0}`,
    );
    refetch();
  };

  const runPostPublishRepair = async (dryRun: boolean) => {
    const { data, error } = await supabase.rpc(
      "admin_m9_post_publish_repair_dispatch" as any,
      { p_limit: 10, p_dry_run: dryRun },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as any;
    toast.success(
      `M9.3b ${dryRun ? "Dry-Run" : "Live"}: dispatched ${res?.dispatched ?? 0}, skipped ${res?.skipped ?? 0} (WIP ${res?.wip_now ?? 0}/${res?.wip_cap ?? 0})`,
    );
    refetch();
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">M9 · Content Sellability</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">lädt…</CardContent>
      </Card>
    );
  }

  const total = data.reduce((s, r) => s + r.total, 0);
  const sellable = data.reduce((s, r) => s + r.sellable, 0);
  const contentGaps = data.reduce(
    (s, r) => s + r.modules_missing + r.lessons_missing + r.lessons_not_ready,
    0,
  );
  const publishedLocked = data.reduce(
    (s, r) => s + (r.content_gap_published_locked ?? 0),
    0,
  );
  const pct = total > 0 ? Math.round((sellable / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          M9 · Content Sellability Gap Closure
          <Badge variant={contentGaps === 0 ? "default" : "secondary"}>
            {sellable}/{total} sellable · {pct}%
          </Badge>
          {publishedLocked > 0 && (
            <Badge variant="outline">
              {publishedLocked} published-locked (M9.3b)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">
          Track-aware: EXAM_FIRST braucht nur ≥50 approved questions + Pricing.
          AUSBILDUNG_VOLL / EXAM_FIRST_PLUS zusätzlich Modules + Lessons (ready).
          <strong className="ml-1">published-locked</strong> = Pipeline-Guards
          blocken Repair-Jobs auf published Paketen; eigener Post-Publish Worker
          (M9.3b) folgt — Backfill ignoriert diese Klasse.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1">Track</th>
                <th>Total</th>
                <th>Sellable</th>
                <th>Mod−</th>
                <th>Les−</th>
                <th>NotReady</th>
                <th>Locked</th>
                <th>Q−</th>
                <th>Pric−</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.track} className="border-t">
                  <td className="py-1 font-medium">{r.track}</td>
                  <td>{r.total}</td>
                  <td>{r.sellable}</td>
                  <td>{r.modules_missing || ""}</td>
                  <td>{r.lessons_missing || ""}</td>
                  <td>{r.lessons_not_ready || ""}</td>
                  <td>{r.content_gap_published_locked || ""}</td>
                  <td>{r.questions_missing || ""}</td>
                  <td>{r.pricing_missing || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => runBackfill(true)}>
            Dry-Run (10)
          </Button>
          <Button
            size="sm"
            onClick={() => runBackfill(false)}
            disabled={contentGaps === 0}
          >
            Repair-Backfill (10)
          </Button>
        </div>
        {contentGaps === 0 && publishedLocked === 0 && (
          <p className="text-muted-foreground">
            Keine echten Content-Gaps offen.
          </p>
        )}
        {contentGaps === 0 && publishedLocked > 0 && (
          <p className="text-muted-foreground">
            Keine pipeline-reparierbaren Gaps. {publishedLocked} Pakete warten
            auf M9.3b Post-Publish Content-Repair Worker.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
