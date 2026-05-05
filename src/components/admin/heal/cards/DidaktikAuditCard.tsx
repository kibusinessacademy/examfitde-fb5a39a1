/**
 * DidaktikAuditCard — SSOT Admin-Tool für Didaktik-Audits.
 * Scan via admin_didaktik_audit_scan, Multiselect, optionaler Bronze-Bypass,
 * Heal via admin_didaktik_heal_packages. Loggt in auto_heal_log.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Wrench, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";

interface AuditRow {
  package_id: string;
  title: string;
  status: string;
  track: string | null;
  bronze_locked: boolean;
  total_didactic: number;
  done_didactic: number;
  open_didactic: number;
  failed_didactic: number;
  blocked_didactic: number;
  open_steps: string[] | null;
  last_progress_at: string | null;
}

export function DidaktikAuditCard() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bypass, setBypass] = useState(false);

  const q = useQuery({
    queryKey: ["didaktik-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_didaktik_audit_scan" as any);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 60_000,
  });

  const heal = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      if (ids.length === 0) throw new Error("Keine Pakete ausgewählt");
      const { data, error } = await supabase.rpc("admin_didaktik_heal_packages" as any, {
        p_package_ids: ids,
        p_bypass_bronze: bypass,
      });
      if (error) throw error;
      return data as { reset: number; skipped: number };
    },
    onSuccess: (res) => {
      toast.success(`Didaktik-Heal: ${res.reset} reset · ${res.skipped} skipped`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["didaktik-audit"] });
      qc.invalidateQueries({ queryKey: ["build-integrity-e2e"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Heal fehlgeschlagen"),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (!q.data) return;
    if (selected.size === q.data.length) setSelected(new Set());
    else setSelected(new Set(q.data.map((r) => r.package_id)));
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="h-4 w-4" /> Didaktik-Audit (SSOT)
          <Badge variant="outline" className="text-[10px]">
            {q.data?.length ?? 0} Pakete
          </Badge>
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch id="bronze-bypass" checked={bypass} onCheckedChange={setBypass} />
            <Label htmlFor="bronze-bypass" className="text-xs flex items-center gap-1">
              <ShieldOff className="h-3 w-3" /> Bronze-Bypass
            </Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["didaktik-audit"] })}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Scan
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || heal.isPending}
            onClick={() => heal.mutate()}
          >
            <Wrench className="h-3.5 w-3.5 mr-1.5" />
            Heal {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (q.data?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Keine Pakete mit didaktischen Lücken.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="p-2 w-8">
                  <Checkbox
                    checked={selected.size > 0 && selected.size === (q.data?.length ?? 0)}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="p-2 text-left">Paket</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2 text-center">Done/Total</th>
                <th className="p-2 text-center">Failed</th>
                <th className="p-2 text-center">Blocked</th>
                <th className="p-2 text-left">Offene Steps</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.package_id} className="border-b hover:bg-muted/30">
                  <td className="p-2">
                    <Checkbox
                      checked={selected.has(r.package_id)}
                      onCheckedChange={() => toggle(r.package_id)}
                    />
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.package_id.slice(0, 8)} · {r.track ?? "—"}
                      {r.bronze_locked && (
                        <Badge variant="outline" className="ml-1 text-[9px] border-amber-500 text-amber-700">
                          bronze
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-center">
                    <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  </td>
                  <td className="p-2 text-center tabular-nums">
                    {r.done_didactic}/{r.total_didactic}
                  </td>
                  <td className="p-2 text-center tabular-nums">
                    {r.failed_didactic > 0 ? (
                      <span className="text-destructive font-bold">{r.failed_didactic}</span>
                    ) : 0}
                  </td>
                  <td className="p-2 text-center tabular-nums">
                    {r.blocked_didactic > 0 ? (
                      <span className="text-warning font-bold">{r.blocked_didactic}</span>
                    ) : 0}
                  </td>
                  <td className="p-2 text-[10px] font-mono max-w-xs truncate">
                    {(r.open_steps ?? []).slice(0, 3).join(", ")}
                    {(r.open_steps?.length ?? 0) > 3 && ` +${(r.open_steps?.length ?? 0) - 3}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        SSOT: <code>admin_didaktik_audit_scan</code> · Heal setzt failed/blocked/pending_enqueue auf queued
        zurück und loggt in <code>auto_heal_log</code>. Bronze-Bypass übersteuert den Bronze-Lock.
      </p>
    </Card>
  );
}
