import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flame, CalendarClock, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useReEntryState, trackReEntryEvent } from "@/hooks/useReEntryState";

interface Props {
  curriculumId: string;
}

/**
 * Track 5 — Re-Entry Card.
 * Surfaces: streak, days-to-exam, single suggested next action.
 * Mobile-first, but renders on all viewports.
 */
export function MobileReEntryCard({ curriculumId }: Props) {
  const { data, isLoading } = useReEntryState(curriculumId);
  if (isLoading || !data) return null;

  const action = data.suggested_action;
  const streak = data.streak_current;
  const dte = data.days_to_exam;

  return (
    <Card className="border-border/60 bg-surface-elevated shadow-elev-1">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Flame
              className={`h-4 w-4 ${streak > 0 ? "text-warning" : "text-muted-foreground"}`}
            />
            <span className="font-medium">
              {streak > 0 ? `${streak}-Tage-Streak` : "Streak starten"}
            </span>
            {data.streak_longest > streak && (
              <span className="text-xs text-muted-foreground">
                · Bestwert {data.streak_longest}
              </span>
            )}
          </div>
          {typeof dte === "number" && dte >= 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              <span>
                {dte === 0 ? "Prüfung heute" : `${dte} Tage bis Prüfung`}
              </span>
              <span className="text-[10px] uppercase tracking-wide opacity-70">
                · {data.exam_phase}
              </span>
            </div>
          )}
        </div>
        <Button
          asChild
          size="lg"
          className="w-full justify-between"
          onClick={() =>
            trackReEntryEvent("resume_clicked", {
              curriculumId,
              payload: { action_key: action.key, deeplink: action.deeplink },
            })
          }
        >
          <Link to={action.deeplink}>
            <span>{action.label}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
