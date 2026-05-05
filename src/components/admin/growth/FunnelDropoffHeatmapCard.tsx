import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Flame } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Row {
  package_id: string;
  package_key: string | null;
  persona: string;
  step_view: number;
  step_quiz_start: number;
  step_quiz_complete: number;
  step_lead_capture: number;
  step_pricing: number;
  step_add_to_cart: number;
  step_checkout_start: number;
  step_checkout_complete: number;
  dropoff_view_to_quiz: number | null;
  dropoff_quiz_to_lead: number | null;
  dropoff_lead_to_pricing: number | null;
  dropoff_pricing_to_cart: number | null;
  dropoff_cart_to_checkout: number | null;
  dropoff_checkout_to_complete: number | null;
  overall_conversion: number | null;
}

function heatColor(pct: number | null): string {
  if (pct == null) return "bg-muted text-muted-foreground";
  if (pct >= 75) return "bg-destructive/30 text-destructive font-semibold";
  if (pct >= 50) return "bg-orange-500/25 text-orange-700 dark:text-orange-300";
  if (pct >= 25) return "bg-amber-500/20 text-amber-700 dark:text-amber-300";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
}

const STEPS: Array<[keyof Row, string]> = [
  ["dropoff_view_to_quiz", "View→Quiz"],
  ["dropoff_quiz_to_lead", "Quiz→Lead"],
  ["dropoff_lead_to_pricing", "Lead→Pricing"],
  ["dropoff_pricing_to_cart", "Pricing→Cart"],
  ["dropoff_cart_to_checkout", "Cart→Checkout"],
  ["dropoff_checkout_to_complete", "Checkout→Done"],
];

export default function FunnelDropoffHeatmapCard() {
  const [days, setDays] = useState("30");

  const q = useQuery({
    queryKey: ["funnel-dropoff-heatmap", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_funnel_dropoff_heatmap" as any, {
        p_days: Number(days),
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" /> Funnel-Dropoff-Heatmap pro Lead-Magnet
        </CardTitle>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 Tage</SelectItem>
            <SelectItem value="30">30 Tage</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {q.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {q.data && q.data.length === 0 && (
          <p className="text-xs text-muted-foreground">Noch keine Funnel-Daten in diesem Zeitraum.</p>
        )}
        {q.data && q.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1.5">Paket</th>
                  <th className="text-left p-1.5">Persona</th>
                  <th className="text-right p-1.5">Views</th>
                  {STEPS.map(([, label]) => (
                    <th key={label} className="text-center p-1.5">{label}</th>
                  ))}
                  <th className="text-right p-1.5">Overall</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={`${r.package_id}-${r.persona}`} className="border-b hover:bg-muted/50">
                    <td className="p-1.5 font-mono truncate max-w-[180px]" title={r.package_key ?? ""}>
                      {r.package_key ?? r.package_id.slice(0, 8)}
                    </td>
                    <td className="p-1.5">{r.persona}</td>
                    <td className="p-1.5 text-right">{r.step_view}</td>
                    {STEPS.map(([k, label]) => {
                      const v = r[k] as number | null;
                      return (
                        <td key={label} className={`p-1.5 text-center ${heatColor(v)}`}>
                          {v == null ? "—" : `${v}%`}
                        </td>
                      );
                    })}
                    <td className="p-1.5 text-right font-semibold">
                      {r.overall_conversion == null ? "—" : `${r.overall_conversion}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">
          Heat: grün ≤25 %, gelb 25–50 %, orange 50–75 %, rot ≥75 % Drop-off. Quelle: <code>v_funnel_dropoff_per_lead_magnet</code> (DISTINCT visitors).
        </p>
      </CardContent>
    </Card>
  );
}
