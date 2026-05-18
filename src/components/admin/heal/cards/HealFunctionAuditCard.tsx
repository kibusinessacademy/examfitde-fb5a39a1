/**
 * HealFunctionAuditCard
 *
 * Vollständiges Funktions-Audit aller Heal/Enqueue-Producer.
 * Zeigt enqueue_source-Tag-Compliance und drift-guard-Nutzung.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stethoscope, RefreshCw, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type AuditRow = {
  function_name: string;
  args: string;
  uses_enqueue_source_tag: boolean;
  uses_drift_guard: boolean;
  calls_enqueue: boolean;
  has_role_gate: boolean;
  is_security_definer: boolean;
};

function Bool({ v }: { v: boolean }) {
  return v
    ? <Check className="h-3 w-3 text-status-success-fg inline" />
    : <X className="h-3 w-3 text-status-error-fg inline" />;
}

export function HealFunctionAuditCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["heal-function-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_heal_function_audit");
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const violations = data?.filter(r => r.calls_enqueue && !r.uses_enqueue_source_tag) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Heal-Function Audit
          </CardTitle>
          <CardDescription>
            {data ? `${data.length} Funktionen, ${violations.length} ohne enqueue_source-Tag` : "Lade…"}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-text-muted border-b border-border-subtle">
                <tr>
                  <th className="text-left p-1">Funktion</th>
                  <th className="text-center p-1">enqueue_src</th>
                  <th className="text-center p-1">drift_guard</th>
                  <th className="text-center p-1">enqueues</th>
                  <th className="text-center p-1">role_gate</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((r) => {
                  const violating = r.calls_enqueue && !r.uses_enqueue_source_tag;
                  return (
                    <tr key={r.function_name} className={violating ? "bg-status-warning-bg-subtle" : ""}>
                      <td className="p-1 font-mono">{r.function_name}</td>
                      <td className="p-1 text-center"><Bool v={r.uses_enqueue_source_tag} /></td>
                      <td className="p-1 text-center"><Bool v={r.uses_drift_guard} /></td>
                      <td className="p-1 text-center"><Bool v={r.calls_enqueue} /></td>
                      <td className="p-1 text-center"><Bool v={r.has_role_gate} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {violations.length > 0 && (
          <p className="text-xs text-status-warning-fg mt-2">
            ⚠ {violations.length} Funktionen rufen enqueue_job_if_absent ohne enqueue_source-Tag auf — Phase-2-Hard-Block ab 2026-05-09.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
