import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Row {
  package_id: string;
  title: string;
  status: string;
  track: string;
  approved_questions: number;
  exam_blueprints: number;
  learning_fields: number;
  competencies: number;
  oral_blueprints: number;
  generate_oral_exam_status: string | null;
  generate_oral_exam_last_error: string | null;
  has_pending_seed_job: boolean;
  eligibility:
    | "READY"
    | "SKIP_HAS_ORAL"
    | "BLOCKED_NO_LEARNING_FIELDS"
    | "BLOCKED_FEW_QUESTIONS";
  reason: string;
}

const TONE: Record<Row["eligibility"], "default" | "secondary" | "destructive" | "outline"> = {
  READY: "default",
  SKIP_HAS_ORAL: "secondary",
  BLOCKED_NO_LEARNING_FIELDS: "destructive",
  BLOCKED_FEW_QUESTIONS: "destructive",
};

export function OralSeedDiagnosticsCard({ packageId }: { packageId?: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["oral-seed-diagnostics", packageId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_oral_seed_diagnostics" as any,
        { p_package_id: packageId ?? null }
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Oral-Seed Diagnostics</span>
          <span className="text-xs font-normal text-muted-foreground">
            Eligibility & artifact counts per package
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-xs text-muted-foreground">Lade …</div>}
        {error && <div className="text-xs text-destructive">{(error as Error).message}</div>}
        {data && data.length === 0 && (
          <div className="text-xs text-muted-foreground">Keine Pakete gefunden.</div>
        )}
        {data?.map((r) => (
          <div key={r.package_id} className="rounded-md border p-2 text-xs space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium truncate">{r.title}</span>
              <Badge variant="outline" className="text-[10px]">{r.track}</Badge>
              <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
              <Badge variant={TONE[r.eligibility]} className="text-[10px]">
                {r.eligibility}
              </Badge>
              {r.has_pending_seed_job && (
                <Badge variant="secondary" className="text-[10px]">seed job pending</Badge>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 font-mono text-[11px] text-muted-foreground">
              <div>approved Qs: <span className="text-foreground">{r.approved_questions}</span></div>
              <div>exam BPs: <span className="text-foreground">{r.exam_blueprints}</span></div>
              <div>LFs: <span className="text-foreground">{r.learning_fields}</span></div>
              <div>comps: <span className="text-foreground">{r.competencies}</span></div>
              <div>oral BPs: <span className="text-foreground">{r.oral_blueprints}</span></div>
            </div>
            <div className="text-muted-foreground">{r.reason}</div>
            {r.generate_oral_exam_status && (
              <div className="text-[11px]">
                <span className="text-muted-foreground">generate_oral_exam:</span>{" "}
                <code>{r.generate_oral_exam_status}</code>
                {r.generate_oral_exam_last_error && (
                  <span className="text-destructive"> · {r.generate_oral_exam_last_error}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
