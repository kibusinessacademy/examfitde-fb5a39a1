import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

type Funnel = {
  summary: Record<string, number>;
  rescue_candidates: Array<{
    user_id: string;
    curriculum_id: string;
    grant_id: string;
    activation_state: string;
    last_activity_at: string | null;
    streak_current: number;
  }>;
  generated_at: string;
};

const STATES = ["NOT_STARTED", "ONBOARDING", "ACTIVATED", "ENGAGED", "AT_RISK", "DORMANT"] as const;

const STATE_TONE: Record<string, string> = {
  NOT_STARTED: "bg-status-info-bg-subtle text-status-info-fg",
  ONBOARDING: "bg-status-info-bg-subtle text-status-info-fg",
  ACTIVATED: "bg-status-success-bg-subtle text-status-success-fg",
  ENGAGED: "bg-status-success-bg-subtle text-status-success-fg",
  AT_RISK: "bg-status-warning-bg-subtle text-status-warning-fg",
  DORMANT: "bg-status-error-bg-subtle text-status-error-fg",
};

export function ActivationFunnelCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "activation-funnel"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_activation_funnel" as any);
      if (error) throw error;
      return data as unknown as Funnel;
    },
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Learner Activation Funnel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {STATES.map((s) => (
                <Badge key={s} variant="secondary" className={STATE_TONE[s] ?? ""}>
                  {s}: {data?.summary?.[s] ?? 0}
                </Badge>
              ))}
            </div>

            <div>
              <div className="text-xs text-text-muted mb-2">
                Rescue Candidates (AT_RISK + DORMANT, älteste zuerst)
              </div>
              <div className="rounded-md border border-border divide-y divide-border max-h-64 overflow-auto">
                {(data?.rescue_candidates ?? []).length === 0 ? (
                  <div className="p-3 text-sm text-text-muted">Keine.</div>
                ) : (
                  data!.rescue_candidates.map((r) => (
                    <div
                      key={r.grant_id}
                      className="p-2 text-xs flex items-center justify-between gap-2"
                    >
                      <div className="font-mono truncate">
                        {r.user_id.slice(0, 8)} · curr {r.curriculum_id.slice(0, 8)}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={STATE_TONE[r.activation_state]}>
                          {r.activation_state}
                        </Badge>
                        <span className="text-text-muted">
                          {r.last_activity_at
                            ? new Date(r.last_activity_at).toLocaleDateString()
                            : "—"}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
