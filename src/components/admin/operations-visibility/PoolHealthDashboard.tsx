import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge, RefreshCw, AlertTriangle } from "lucide-react";

interface PoolRow {
  pool: string;
  queued: number;
  processing: number;
  throughput_1h: number;
  failed_1h: number;
  oldest_queued_min: number;
  starvation: boolean;
}

export function PoolHealthDashboard() {
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("v_admin_pool_health").select("*");
    setRows((data ?? []) as PoolRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> Pool Health
          <span className="text-xs text-muted-foreground">— Worker-Pools Leitstelle</span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.length === 0 && (
            <div className="col-span-full text-xs text-muted-foreground text-center py-6">Keine Pool-Daten</div>
          )}
          {rows.map((p) => (
            <div key={p.pool} className={`rounded border p-3 text-xs ${p.starvation ? "border-red-500 bg-red-50 dark:bg-red-950/20" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <code className="text-sm font-semibold">{p.pool}</code>
                {p.starvation && (
                  <Badge className="bg-red-600 text-white text-[10px]"><AlertTriangle className="h-3 w-3 mr-1" />Starvation</Badge>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-y-1 gap-x-3">
                <dt className="text-muted-foreground">queued</dt><dd className="text-right font-mono">{p.queued}</dd>
                <dt className="text-muted-foreground">processing</dt><dd className="text-right font-mono">{p.processing}</dd>
                <dt className="text-muted-foreground">throughput/1h</dt><dd className="text-right font-mono">{p.throughput_1h}</dd>
                <dt className="text-muted-foreground">failed/1h</dt><dd className={`text-right font-mono ${p.failed_1h > 0 ? "text-red-600" : ""}`}>{p.failed_1h}</dd>
                <dt className="text-muted-foreground">oldest (min)</dt><dd className={`text-right font-mono ${p.oldest_queued_min > 30 ? "text-orange-600" : ""}`}>{p.oldest_queued_min}</dd>
              </dl>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
