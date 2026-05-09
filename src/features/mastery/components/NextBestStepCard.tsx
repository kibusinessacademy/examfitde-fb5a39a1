import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Brain, AlertTriangle, Target, Zap, Sparkles, Loader2 } from "lucide-react";

type Step = {
  competency_id: string;
  competency_title: string;
  recommended_action: string;
  reason: string;
  mastery_score: number;
  decay_score: number;
  exam_readiness: number;
  priority_score: number;
  payload: Record<string, unknown> | null;
};

const ACTION_META: Record<string, { label: string; icon: typeof Target; tone: string }> = {
  REPAIR: { label: "Reparieren", icon: AlertTriangle, tone: "destructive" },
  DRILL: { label: "Üben", icon: Target, tone: "default" },
  REINFORCE: { label: "Festigen", icon: Zap, tone: "secondary" },
  CHALLENGE: { label: "Vertiefen", icon: Sparkles, tone: "outline" },
};

interface Props {
  courseId: string;
  limit?: number;
}

export function NextBestStepCard({ courseId, limit = 5 }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["learner-next-best-step", courseId, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("learner_next_best_step" as any, {
        p_course_id: courseId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as Step[];
    },
    enabled: !!courseId,
    staleTime: 60_000,
  });

  return (
    <Card data-testid="next-best-step-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-primary" />
          Nächste beste Aufgaben (Mastery v2)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Empfehlungen aus Mastery, Confidence & Decay deines Lernpfads.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Konnte Empfehlungen nicht laden.</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Empfehlungen — starte ein paar Übungen, damit dein Lernsystem dich kennt.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="next-best-step-list">
            {data.map((s) => {
              const meta = ACTION_META[s.recommended_action] ?? ACTION_META.DRILL;
              const Icon = meta.icon;
              return (
                <li
                  key={s.competency_id}
                  className="border rounded-md p-2.5 hover:bg-muted/30 transition-colors"
                  data-testid="next-best-step-item"
                >
                  <div className="flex items-start gap-2">
                    <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">
                          {s.competency_title}
                        </span>
                        <Badge variant={meta.tone as any} className="text-[10px]">
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {s.reason}
                      </p>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                        <div>
                          <div className="text-muted-foreground">Mastery</div>
                          <Progress value={s.mastery_score} className="h-1 mt-0.5" />
                          <div className="tabular-nums">{Math.round(s.mastery_score)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Decay</div>
                          <Progress value={s.decay_score} className="h-1 mt-0.5" />
                          <div className="tabular-nums">{Math.round(s.decay_score)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Readiness</div>
                          <Progress value={s.exam_readiness} className="h-1 mt-0.5" />
                          <div className="tabular-nums">{Math.round(s.exam_readiness)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
