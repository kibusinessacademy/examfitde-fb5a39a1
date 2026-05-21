import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GovRow {
  version_id: string;
  version_no: number;
  change_kind: string;
  adjusted_count: number;
  capped_count: number;
  max_abs_delta: number;
  created_at: string;
}

export function PolicyGovernanceCard() {
  const [rows, setRows] = useState<GovRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("admin_get_policy_governance_summary", { p_limit: 20 });
      setRows((data as GovRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Policy Governance (letzte 20 Versionen)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Lade …</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Policy-Versionen.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.version_id} className="flex items-center justify-between rounded-md border border-border p-2">
                <div className="flex flex-col">
                  <span className="font-medium">v{r.version_no} · {r.change_kind}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} · Δmax {Number(r.max_abs_delta ?? 0).toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{r.adjusted_count} adj</Badge>
                  {r.capped_count > 0 && <Badge variant="secondary">{r.capped_count} capped</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PolicyGovernanceCard;
