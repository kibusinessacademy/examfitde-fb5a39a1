/**
 * CommerceReadinessCard — Stage A read-only Cockpit.
 *
 * Quelle: RPCs admin_get_commerce_gap_summary + admin_get_commerce_gap_detail
 * (SECURITY DEFINER, has_role gated).
 *
 * Dies ist der Detect-Layer des Commerce Readiness Orchestrators.
 * Auto-Dispatch (Stage B+) wird durch Architectural-Continuity-Review gegated.
 */
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, ShoppingCart, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { COMMERCE_HEAL_MATRIX, type CommerceGapCode } from "@/lib/commerce/commerceHealMatrix";

interface Summary {
  total: number;
  fully_operational: number;
  with_gaps: number;
  severity_3: number;
  severity_2: number;
  severity_1: number;
  gap_distribution: Record<string, number> | null;
  last_smoke_at: string | null;
  last_smoke_run_id: string | null;
  snapshot_at: string;
  error?: string;
}

interface DetailRow {
  package_id: string;
  package_key: string | null;
  package_title: string | null;
  canonical_slug: string | null;
  is_published: boolean;
  sellable: boolean;
  fully_operational: boolean;
  bronze_locked: boolean;
  gap_codes: string[] | null;
  severity: number;
  last_smoke_success: boolean | null;
  last_smoke_at: string | null;
}

const sevTone = (s: number): string => {
  if (s === 3) return "bg-status-error-bg-subtle text-status-error-fg";
  if (s === 2) return "bg-status-warning-bg-subtle text-status-warning-fg";
  if (s === 1) return "bg-surface-muted text-text-muted";
  return "bg-status-success-bg-subtle text-status-success-fg";
};

export function CommerceReadinessCard() {
  const summary = useQuery({
    queryKey: ["commerce_gap_summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_commerce_gap_summary" as any);
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
  });

  const detail = useQuery({
    queryKey: ["commerce_gap_detail"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_commerce_gap_detail" as any, {
        p_severity_min: 2,
        p_limit: 10,
        p_offset: 0,
        p_only_visible: true,
      });
      if (error) throw error;
      return (data ?? []) as DetailRow[];
    },
    refetchInterval: 60_000,
  });

  const s = summary.data;
  const isForbidden = s?.error === "forbidden";
  const distribution = s?.gap_distribution ?? {};
  const distEntries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-text" />
          <h3 className="text-sm font-semibold text-text">Commerce Readiness</h3>
          <Badge variant="outline" className="text-xs">Stage A · detect-only</Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            summary.refetch();
            detail.refetch();
          }}
          disabled={summary.isFetching || detail.isFetching}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${summary.isFetching || detail.isFetching ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <p className="text-xs text-text-muted">
        Detect-Layer des autonomen Commerce-Heal-Systems. Klassifiziert pro Paket
        bis zu 10 Lücken-Codes. Auto-Dispatch (Stage B+) durch Governance-Review gegated.
      </p>

      {summary.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isForbidden ? (
        <div className="flex items-center gap-2 text-sm text-status-warning-fg">
          <AlertTriangle className="h-4 w-4" /> Admin-Rolle erforderlich.
        </div>
      ) : !s ? (
        <div className="text-sm text-text-muted">Keine Daten.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Kpi label="Pakete gesamt" value={s.total} />
            <Kpi
              label="Fully operational"
              value={s.fully_operational}
              tone="bg-status-success-bg-subtle text-status-success-fg"
            />
            <Kpi
              label="Mit Lücken"
              value={s.with_gaps}
              tone={s.with_gaps > 0 ? "bg-status-warning-bg-subtle text-status-warning-fg" : undefined}
            />
            <Kpi
              label="Sev3 (revenue)"
              value={s.severity_3}
              tone={s.severity_3 > 0 ? "bg-status-error-bg-subtle text-status-error-fg" : undefined}
            />
          </div>

          {distEntries.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                Gap-Verteilung
              </div>
              <div className="flex flex-wrap gap-1.5">
                {distEntries.map(([code, n]) => {
                  const rule = COMMERCE_HEAL_MATRIX[code as CommerceGapCode];
                  return (
                    <span
                      key={code}
                      title={rule?.description ?? code}
                      className={`px-2 py-0.5 rounded text-[10px] ${sevTone(rule?.severityHint ?? 1)}`}
                    >
                      {code} · {n}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
              Top stuck (severity ≥ 2, sichtbar)
            </div>
            {detail.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (detail.data ?? []).length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-status-success-fg">
                <CheckCircle2 className="h-4 w-4" />
                Keine sichtbaren Pakete mit Severity ≥ 2.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-text-muted">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3">Paket</th>
                      <th className="text-left py-2 pr-3">Sev</th>
                      <th className="text-left py-2 pr-3">Gaps</th>
                      <th className="text-left py-2">Smoke</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.data ?? []).map((r) => (
                      <tr key={r.package_id} className="border-b border-border/50">
                        <td className="py-2 pr-3">
                          <div className="text-text font-medium">
                            {r.package_title ?? r.package_key ?? r.package_id.slice(0, 8)}
                          </div>
                          <div className="text-[10px] text-text-muted font-mono">
                            {r.canonical_slug ?? "—"}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${sevTone(r.severity)}`}>
                            {r.severity}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {(r.gap_codes ?? []).map((c) => (
                              <span
                                key={c}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-surface-muted text-text-muted"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 text-[10px] text-text-muted">
                          {r.last_smoke_success === null
                            ? "—"
                            : r.last_smoke_success
                              ? "✓"
                              : "✗"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="text-[10px] text-text-muted">
            Letzter Smoke: {s.last_smoke_at ?? "—"} · Snapshot: {s.snapshot_at}
          </div>
        </>
      )}
    </Card>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`p-2 rounded ${tone ?? "bg-surface-muted text-text"}`}>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
