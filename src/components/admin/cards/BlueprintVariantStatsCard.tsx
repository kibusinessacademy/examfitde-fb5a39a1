import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Beaker, CheckCircle2, XCircle, Clock } from "lucide-react";

interface VariantStat {
  blueprint_id: string;
  blueprint_name: string;
  total_variants: number;
  promoted: number;
  in_review: number;
  skipped: number;
  avg_quality: number;
  transfer_pct: number;
  transfer_count: number;
  parameter_count: number;
  context_count: number;
  trap_count: number;
  structure_count: number;
  gate_status: "passed" | "failed" | "pending";
}

const GATE_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  passed: { label: "Bestanden", variant: "default" },
  failed: { label: "Nicht bestanden", variant: "destructive" },
  pending: { label: "Ausstehend", variant: "secondary" },
};

export default function BlueprintVariantStatsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "blueprint-variant-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_blueprint_variant_stats" as any)
        .select("*")
        .order("total_variants", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as VariantStat[];
    },
    refetchInterval: 30_000,
  });

  const stats = data ?? [];
  const total = stats.length;
  const passed = stats.filter((s) => s.gate_status === "passed").length;
  const failed = stats.filter((s) => s.gate_status === "failed").length;
  const pending = stats.filter((s) => s.gate_status === "pending").length;
  const totalVariants = stats.reduce((s, v) => s + v.total_variants, 0);
  const totalPromoted = stats.reduce((s, v) => s + v.promoted, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Beaker className="h-4 w-4 text-primary" />
          Blueprint-Varianten
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary KPIs */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <p className="text-lg font-bold">{totalVariants}</p>
            <p className="text-[10px] text-muted-foreground">Varianten</p>
          </div>
          <div>
            <p className="text-lg font-bold text-primary">{totalPromoted}</p>
            <p className="text-[10px] text-muted-foreground">Promoted</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-600">{passed}</p>
            <p className="text-[10px] text-muted-foreground">Gates ✓</p>
          </div>
          <div>
            <p className="text-lg font-bold text-destructive">{failed}</p>
            <p className="text-[10px] text-muted-foreground">Gates ✗</p>
          </div>
        </div>

        {isLoading && <p className="text-xs text-muted-foreground">Laden…</p>}

        {/* Per-blueprint rows */}
        <div className="space-y-2 max-h-[320px] overflow-y-auto">
          {stats.map((s) => {
            const badge = GATE_BADGE[s.gate_status] ?? GATE_BADGE.pending;
            const GateIcon =
              s.gate_status === "passed" ? CheckCircle2 : s.gate_status === "failed" ? XCircle : Clock;
            return (
              <div
                key={s.blueprint_id}
                className="rounded-lg border p-2.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium truncate flex-1">
                    {s.blueprint_name}
                  </p>
                  <Badge variant={badge.variant} className="text-[10px] gap-1">
                    <GateIcon className="h-3 w-3" />
                    {badge.label}
                  </Badge>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{s.total_variants} Var.</span>
                  <span className="text-primary">{s.promoted} prom.</span>
                  <span>{s.in_review} review</span>
                  <span>Ø {s.avg_quality}</span>
                </div>

                {/* Type distribution bar */}
                {s.total_variants > 0 && (
                  <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                    {s.transfer_count > 0 && (
                      <div
                        className="bg-emerald-500"
                        style={{ width: `${(s.transfer_count / s.total_variants) * 100}%` }}
                        title={`Transfer: ${s.transfer_count}`}
                      />
                    )}
                    {s.context_count > 0 && (
                      <div
                        className="bg-blue-500"
                        style={{ width: `${(s.context_count / s.total_variants) * 100}%` }}
                        title={`Context: ${s.context_count}`}
                      />
                    )}
                    {s.trap_count > 0 && (
                      <div
                        className="bg-amber-500"
                        style={{ width: `${(s.trap_count / s.total_variants) * 100}%` }}
                        title={`Trap: ${s.trap_count}`}
                      />
                    )}
                    {s.structure_count > 0 && (
                      <div
                        className="bg-purple-500"
                        style={{ width: `${(s.structure_count / s.total_variants) * 100}%` }}
                        title={`Structure: ${s.structure_count}`}
                      />
                    )}
                    {s.parameter_count > 0 && (
                      <div
                        className="bg-gray-400"
                        style={{ width: `${(s.parameter_count / s.total_variants) * 100}%` }}
                        title={`Parameter: ${s.parameter_count}`}
                      />
                    )}
                  </div>
                )}

                {s.total_variants > 0 && (
                  <div className="flex gap-2 text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" /> Transfer {s.transfer_pct}%</span>
                    <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-500 inline-block" /> Context</span>
                    <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" /> Trap</span>
                    <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-purple-500 inline-block" /> Struktur</span>
                    <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" /> Param</span>
                  </div>
                )}
              </div>
            );
          })}

          {!isLoading && stats.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Keine approved Blueprints mit Varianten gefunden.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
