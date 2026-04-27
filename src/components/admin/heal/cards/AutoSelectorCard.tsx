/**
 * AutoSelectorCard — Exam-Pool Repair Auto-Selector.
 * Source: RPC fn_select_exam_pool_repair_action(p_package_id)
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useBlockerDashboard } from "./BlockerCountsCard";

export function AutoSelectorCard() {
  const dashboard = useBlockerDashboard();
  const [selectorPkgId, setSelectorPkgId] = useState("");

  const selectorQuery = useMutation({
    mutationFn: async (pid: string) => {
      const { data, error } = await supabase.rpc(
        "fn_select_exam_pool_repair_action" as any,
        { p_package_id: pid },
      );
      if (error) throw error;
      return data as any;
    },
    onError: (e: any) => toast.error(e?.message ?? "Auto-Select fehlgeschlagen"),
  });

  const candidates = (dashboard.data ?? []).filter(
    (r) => r.primary_blocker === "EXAM_POOL_TOO_SMALL",
  );

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wand2 className="h-4 w-4" /> Exam-Pool Repair Auto-Selector
        </h3>
        <p className="text-xs text-muted-foreground">
          Wählt defect-aware zwischen <code>quality</code>, <code>competency_coverage</code> und{" "}
          <code>lf_coverage</code> Repair-Jobs.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="package_id (UUID)"
          value={selectorPkgId}
          onChange={(e) => setSelectorPkgId(e.target.value)}
          className="font-mono text-xs"
        />
        <Button
          size="sm"
          onClick={() => selectorQuery.mutate(selectorPkgId)}
          disabled={!selectorPkgId || selectorQuery.isPending}
        >
          Analysieren
        </Button>
      </div>
      {selectorQuery.data && (
        <div className="border rounded-md p-3 bg-muted/30 space-y-2">
          <div className="flex items-center gap-2">
            <Badge>{selectorQuery.data.recommended_action}</Badge>
            <span className="text-xs text-muted-foreground">{selectorQuery.data.reason}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Metric label="Track" value={selectorQuery.data.track} />
            <Metric label="Approved" value={`${selectorQuery.data.approved}/${selectorQuery.data.min_required}`} />
            <Metric label="LF Gap %" value={`${selectorQuery.data.lf_gap_pct}%`} />
            <Metric label="Comp Gap %" value={`${selectorQuery.data.comp_gap_pct}%`} />
          </div>
        </div>
      )}
      {candidates.length > 0 && (
        <div className="pt-2 border-t">
          <div className="text-xs font-semibold mb-2">Pakete mit EXAM_POOL_TOO_SMALL</div>
          <div className="space-y-1 max-h-48 overflow-auto">
            {candidates.map((r) => (
              <button
                key={r.package_id}
                onClick={() => {
                  setSelectorPkgId(r.package_id);
                  selectorQuery.mutate(r.package_id);
                }}
                className="w-full text-left text-xs p-2 rounded hover:bg-muted transition"
              >
                <span className="font-mono text-[10px] text-muted-foreground mr-2">
                  {r.package_id.slice(0, 8)}
                </span>
                {r.course_title}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="border rounded p-2 bg-background">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-mono font-semibold">{value}</div>
    </div>
  );
}
