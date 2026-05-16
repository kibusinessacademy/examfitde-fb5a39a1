import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

type Summary = {
  total_published: number;
  customer_safe: number;
  gap: number;
  missing_by_dim: {
    not_sellable: number;
    not_delivery_ready: number;
    not_entitlement_ready: number;
    not_tutor_ready: number;
    not_exam_pool_ready: number;
  };
  computed_at: string;
};

type PkgRow = {
  package_id: string;
  package_key: string | null;
  package_title: string;
  customer_safe: boolean;
  published: boolean;
  sellable: boolean;
  delivery_ready: boolean;
  entitlement_ready: boolean;
  tutor_ready: boolean;
  exam_pool_ready: boolean;
  missing_dimensions: string[] | null;
  gap_class: string | null;
  delivery_blocking_reasons: string[] | null;
  commerce_gate_state: string | null;
  post_publish_state: string | null;
  sub_flags: Record<string, boolean> | null;
};

const DIM_LABELS: Record<string, string> = {
  not_sellable: "Sellable",
  not_delivery_ready: "Delivery",
  not_entitlement_ready: "Entitlement",
  not_tutor_ready: "Tutor",
  not_exam_pool_ready: "Exam-Pool",
};

export function CustomerSafeReadinessCard() {
  const [expanded, setExpanded] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["customer-safe-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_customer_safe_summary" as any,
      );
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
  });

  const packagesQ = useQuery({
    queryKey: ["customer-safe-packages", expanded],
    enabled: expanded,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_customer_safe_packages" as any,
        { _only_unsafe: true, _limit: 200 },
      );
      if (error) throw error;
      return (data ?? []) as PkgRow[];
    },
  });

  const s = summaryQ.data;
  const safePct = s && s.total_published > 0
    ? Math.round((s.customer_safe / s.total_published) * 100)
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            Customer-Safe Readiness (P0 SSOT)
          </CardTitle>
          {s && (
            <Badge variant={s.customer_safe === s.total_published ? "default" : "secondary"}>
              {s.customer_safe} / {s.total_published} ({safePct}%)
            </Badge>
          )}
        </div>
        <p className="text-text-secondary text-xs mt-1">
          published ∧ sellable ∧ delivery ∧ entitlement ∧ tutor ∧ exam-pool —
          alle 6 müssen erfüllt sein.
        </p>
      </CardHeader>
      <CardContent>
        {summaryQ.isLoading && (
          <p className="text-text-secondary text-sm">Lade…</p>
        )}
        {s && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {Object.entries(s.missing_by_dim).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-md border border-border-subtle p-3 bg-surface-subtle"
                >
                  <div className="text-text-secondary text-xs">
                    {DIM_LABELS[k] ?? k}
                  </div>
                  <div className="text-text-primary text-2xl font-semibold">
                    {v as number}
                  </div>
                  <div className="text-text-tertiary text-xs">missing</div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Ausblenden" : `Drill-Down (${s.gap} unsafe)`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => summaryQ.refetch()}
              >
                Refresh
              </Button>
            </div>

            {expanded && (
              <div className="mt-4 max-h-96 overflow-y-auto rounded-md border border-border-subtle">
                {packagesQ.isLoading && (
                  <p className="p-3 text-text-secondary text-sm">Lade Pakete…</p>
                )}
                {packagesQ.data && packagesQ.data.length === 0 && (
                  <p className="p-3 text-text-secondary text-sm">
                    Alle Pakete customer-safe 🎉
                  </p>
                )}
                {packagesQ.data?.map((p) => (
                  <div
                    key={p.package_id}
                    className="p-3 border-b border-border-subtle last:border-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-text-primary text-sm font-medium truncate">
                          {p.package_title}
                        </div>
                        <div className="text-text-tertiary text-xs truncate">
                          {p.package_key}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {p.missing_dimensions?.length ?? 0} missing
                      </Badge>
                    </div>
                    {p.missing_dimensions && p.missing_dimensions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.missing_dimensions.map((r) => (
                          <Badge
                            key={r}
                            variant="secondary"
                            className="text-xs"
                          >
                            {r}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {p.delivery_blocking_reasons &&
                      p.delivery_blocking_reasons.length > 0 && (
                        <div className="mt-1 text-text-tertiary text-xs">
                          delivery: {p.delivery_blocking_reasons.join(", ")}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
