import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Calendar, RefreshCw } from "lucide-react";

interface RenewalRow {
  license_id: string;
  org_id: string;
  org_name: string;
  product_id: string;
  ends_at: string;
  days_to_expiry: number;
  seat_count: number;
  seats_used: number;
  seat_utilization_pct: number;
  risk_level: "critical" | "high" | "medium" | "low";
  cancel_at_period_end: boolean;
  status: string;
}

const RISK_TONE: Record<RenewalRow["risk_level"], string> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

export default function B2bRenewalPipelineCard() {
  const q = useQuery({
    queryKey: ["admin-b2b-renewal-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_b2b_renewal_pipeline");
      if (error) throw error;
      return (data ?? []) as RenewalRow[];
    },
    refetchInterval: 60_000,
  });

  const runSmoke = async () => {
    const { data, error } = await supabase.rpc("admin_smoke_b2b_renewal_pipeline");
    if (error) return toast.error(error.message);
    const ok = (data as any)?.ok;
    toast[ok ? "success" : "error"](
      ok ? "Smoke OK — alle Intents + Producer dry-run" : "Smoke FAIL — Details in Console",
    );
    // eslint-disable-next-line no-console
    console.log("[B2B Renewal Smoke]", data);
  };

  const rows = q.data ?? [];
  const buckets = {
    critical: rows.filter((r) => r.risk_level === "critical").length,
    high: rows.filter((r) => r.risk_level === "high").length,
    medium: rows.filter((r) => r.risk_level === "medium").length,
    low: rows.filter((r) => r.risk_level === "low").length,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4" /> B2B Renewal Pipeline
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="secondary" onClick={runSmoke}>
            Smoke
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="destructive">≤ 7T: {buckets.critical}</Badge>
          <Badge>≤ 14T: {buckets.high}</Badge>
          <Badge variant="secondary">≤ 30T: {buckets.medium}</Badge>
          <Badge variant="outline">≤ 60T: {buckets.low}</Badge>
        </div>

        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Lizenz läuft in den nächsten 60 Tagen ab.</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Org</TableHead>
                  <TableHead className="text-right">T-Minus</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead className="text-right">Auslast.</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((r) => (
                  <TableRow key={r.license_id}>
                    <TableCell className="text-xs">{r.org_name}</TableCell>
                    <TableCell className="text-right text-xs">{r.days_to_expiry}d</TableCell>
                    <TableCell className="text-right text-xs">
                      {r.seats_used}/{r.seat_count}
                    </TableCell>
                    <TableCell className="text-right text-xs">{r.seat_utilization_pct}%</TableCell>
                    <TableCell>
                      <Badge variant={RISK_TONE[r.risk_level] as any}>{r.risk_level}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          Cron: <code>b2b-renewal-intent-producer-hourly</code> · Bundle-Upsell: <code>bundle-upsell-producer-4h</code>
        </p>
      </CardContent>
    </Card>
  );
}
