/**
 * HealStrategyCard — Toggle automatischer Reparatur-Strategien.
 * Source: admin_settings + RPC admin_set_setting
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Setting {
  key: string;
  value: { enabled?: boolean; last_changed_at?: string };
  description: string | null;
  updated_at: string;
}

const HEAL_KEYS = [
  "heal_strategy_hardish_balance",
  "heal_strategy_too_few_approved",
  "heal_strategy_isolated_knowledge",
];

export function HealStrategyCard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings-heal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("*")
        .in("key", HEAL_KEYS);
      if (error) throw error;
      return (data ?? []) as unknown as Setting[];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const { data, error } = await supabase.rpc("admin_set_setting", {
        p_key: key,
        p_value: { enabled, last_changed_at: new Date().toISOString() },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      toast({
        title: "Setting geändert",
        description: `${vars.key} → ${vars.enabled ? "aktiv" : "aus"}`,
      });
      qc.invalidateQueries({ queryKey: ["admin-settings-heal"] });
    },
    onError: (e: Error) =>
      toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Heal-Strategien (Auto-Repair Toggles)</h3>
        <p className="text-xs text-muted-foreground">
          Aktiviert oder deaktiviert automatische Reparatur-Strategien für bestimmte
          Integrity-Reasons. Änderungen werden im Audit-Log protokolliert.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Lade …</div>}
      {data &&
        HEAL_KEYS.map((key) => {
          const s = data.find((x) => x.key === key);
          const enabled = !!s?.value?.enabled;
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-4 border-b pb-3 last:border-0"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`t-${key}`} className="font-mono text-xs">{key}</Label>
                  <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
                    {enabled ? "aktiv" : "aus"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{s?.description ?? "—"}</p>
                {s?.updated_at && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Zuletzt geändert: {new Date(s.updated_at).toLocaleString("de-DE")}
                  </p>
                )}
              </div>
              <Switch
                id={`t-${key}`}
                checked={enabled}
                disabled={toggle.isPending}
                onCheckedChange={(checked) => toggle.mutate({ key, enabled: checked })}
              />
            </div>
          );
        })}
    </Card>
  );
}
