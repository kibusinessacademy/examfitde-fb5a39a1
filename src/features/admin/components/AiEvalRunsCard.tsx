import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface EvalRun {
  run_id: string;
  dataset_key: string;
  model: string;
  job_type: string;
  status: string;
  score_count: number;
  regression_count: number;
  started_at: string;
}

export function AiEvalRunsCard() {
  const [rows, setRows] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("admin_get_ai_eval_summary", { p_limit: 20 });
      setRows((data as EvalRun[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Eval Runs (letzte 20)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Lade …</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Eval-Runs.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.run_id} className="flex items-center justify-between rounded-md border border-border p-2">
                <div className="flex flex-col">
                  <span className="font-medium">{r.dataset_key}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.model} · {r.job_type} · {new Date(r.started_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "succeeded" ? "secondary" : "destructive"}>{r.status}</Badge>
                  <Badge variant="outline">{r.score_count} scores</Badge>
                  {r.regression_count > 0 && <Badge variant="destructive">{r.regression_count} regr</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AiEvalRunsCard;
