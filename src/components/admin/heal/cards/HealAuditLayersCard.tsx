/**
 * HealAuditLayersCard — Multi-Layer Heal-Auditlog
 * Symptom / Step / DAG / Gate / Artifact mit Vorher/Nachher.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AuditRow {
  id: string;
  created_at: string;
  package_id: string;
  trigger_source: string;
  action_type: string;
  result_status: string;
  notes: string | null;
  symptom_before: any; symptom_after: any;
  step_layer_before: any; step_layer_after: any;
  dag_layer_before: any; dag_layer_after: any;
  gate_layer_before: any; gate_layer_after: any;
  artifact_layer_before: any; artifact_layer_after: any;
}

const Layer = ({ name, before, after }: { name: string; before: any; after: any }) => {
  if (!before && !after) return null;
  return (
    <div className="border rounded p-2 bg-muted/30">
      <div className="text-xs font-semibold mb-1">{name}</div>
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
        <pre className="whitespace-pre-wrap break-all bg-status-error-bg-subtle/40 p-1 rounded">
          {JSON.stringify(before, null, 1)}
        </pre>
        <pre className="whitespace-pre-wrap break-all bg-status-success-bg-subtle/40 p-1 rounded">
          {JSON.stringify(after, null, 1)}
        </pre>
      </div>
    </div>
  );
};

export function HealAuditLayersCard() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["heal-audit-layers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_heal_audit_layers" as any, {
        p_package_id: null,
        p_limit: 100,
      });
      if (error) throw error;
      return data as AuditRow[];
    },
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Heal-Audit Layers (5-Schicht Vorher/Nachher)
          <Badge variant="outline" className="ml-2">Letzte 100</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && (data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Noch keine Heal-Events aufgezeichnet.</p>
        )}
        {(data ?? []).map((row) => {
          const isOpen = openId === row.id;
          return (
            <div key={row.id} className="border rounded-md bg-card">
              <button
                onClick={() => setOpenId(isOpen ? null : row.id)}
                className="w-full text-left p-3 flex items-center justify-between gap-2 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{row.action_type}</Badge>
                    <Badge variant="outline" className={row.result_status === 'success' ? 'text-success' : ''}>
                      {row.result_status}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{row.package_id.slice(0,8)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                  {row.notes && <div className="text-xs text-muted-foreground mt-1">{row.notes}</div>}
                </div>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {isOpen && (
                <div className="p-3 pt-0 space-y-2">
                  <Layer name="Symptom" before={row.symptom_before} after={row.symptom_after} />
                  <Layer name="Step Layer" before={row.step_layer_before} after={row.step_layer_after} />
                  <Layer name="DAG Layer" before={row.dag_layer_before} after={row.dag_layer_after} />
                  <Layer name="Gate Layer" before={row.gate_layer_before} after={row.gate_layer_after} />
                  <Layer name="Artifact Layer" before={row.artifact_layer_before} after={row.artifact_layer_after} />
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
