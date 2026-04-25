import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Clock, ShieldAlert, Network, Lock, AlertTriangle } from "lucide-react";

interface Props {
  packageId: string;
}

interface BlockRow {
  step_key: string;
  status: string;
  block_type: string;
  block_detail: string;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

const TYPE_META: Record<string, { label: string; icon: typeof AlertCircle; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PREREQ:             { label: "Wartet auf Vorgänger",  icon: Clock,        variant: "secondary" },
  CAUSALITY:          { label: "Causality blockiert",   icon: Network,      variant: "secondary" },
  GATE_FAIL:          { label: "Quality-Gate offen",    icon: ShieldAlert,  variant: "destructive" },
  QUALITY:            { label: "Threshold knapp",       icon: ShieldAlert,  variant: "destructive" },
  COVERAGE_GAP:       { label: "Coverage-Lücke",        icon: AlertTriangle,variant: "destructive" },
  HTTP_500:           { label: "Edge-Function 500",     icon: AlertCircle,  variant: "destructive" },
  WAITING_DEPENDENCY: { label: "Wartet (queued)",       icon: Lock,         variant: "outline" },
  OTHER:              { label: "Sonstiges",             icon: AlertCircle,  variant: "outline" },
};

export function PackageBlockDiagnosisPanel({ packageId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["package-block-diagnosis", packageId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_package_block_diagnosis", {
        p_package_id: packageId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as BlockRow[];
    },
    enabled: !!packageId,
    refetchInterval: 15000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Block-Diagnose</span>
          <span className="text-xs text-muted-foreground font-normal">
            Was hält die Pipeline wirklich auf?
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-xs text-muted-foreground">Lade …</div>}
        {error && (
          <div className="text-xs text-destructive">{(error as Error).message}</div>
        )}
        {data && data.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Keine offenen Blocker — alle Steps done oder skipped.
          </div>
        )}
        {data?.map((row) => {
          const meta = TYPE_META[row.block_type] ?? TYPE_META.OTHER;
          const Icon = meta.icon;
          return (
            <div
              key={`${row.step_key}-${row.updated_at}`}
              className="flex items-start gap-2 rounded-md border p-2"
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs font-mono">{row.step_key}</code>
                  <Badge variant={meta.variant} className="text-[10px]">
                    {meta.label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {row.status}
                  </Badge>
                  {row.attempts > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {row.attempts} attempts
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 break-words">
                  {row.block_detail}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
