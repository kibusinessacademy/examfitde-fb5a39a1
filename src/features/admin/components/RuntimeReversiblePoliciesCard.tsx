import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Undo2, ShieldCheck, ShieldOff } from "lucide-react";

interface Policy {
  action_key: string;
  is_reversible: boolean;
  max_age_minutes: number;
  rollback_handler_key: string | null;
  requires_admin_confirm: boolean;
  notes: string | null;
}

export default function RuntimeReversiblePoliciesCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["runtime-reversible-policies"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_reversible_policies" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Policy[];
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Undo2 className="h-4 w-4" /> Reversible Action Policies
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted/30" />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {(data ?? []).map((p) => (
              <div
                key={p.action_key}
                className="flex flex-wrap items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm"
              >
                {p.is_reversible ? (
                  <ShieldCheck className="h-4 w-4 text-status-fg-success" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-muted-foreground/60" />
                )}
                <span className="font-mono text-xs">{p.action_key}</span>
                <Badge variant={p.is_reversible ? "default" : "outline"} className="text-[10px]">
                  {p.is_reversible ? "reversible" : "one-way"}
                </Badge>
                {p.is_reversible && (
                  <Badge variant="outline" className="text-[10px]">
                    window {p.max_age_minutes}min
                  </Badge>
                )}
                {p.rollback_handler_key && (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{p.rollback_handler_key}</code>
                )}
                {p.notes && (
                  <span className="basis-full text-[11px] text-muted-foreground">{p.notes}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
