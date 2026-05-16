import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

type Row = {
  job_id: string;
  kind: string;
  channel: string;
  state: string;
  suppression_reason: string | null;
  scheduled_for: string;
  delivered_at: string | null;
  payload: any;
  was_opened: boolean;
  opened_at: string | null;
};

const KIND_LABEL: Record<string, string> = {
  daily_reminder: "Tageserinnerung",
  rescue: "Rescue-Hinweis",
  streak_recovery: "Streak-Recovery",
  exam_countdown: "Prüfungs-Countdown",
  weak_competency: "Schwächen-Erinnerung",
  readiness_summary: "Readiness-Zusammenfassung",
};

const REASON_LABEL: Record<string, string> = {
  channel_optout: "Kanal deaktiviert",
  quiet_hours: "Ruhezeit",
  fatigue_suppress: "Erschöpfungsschutz",
  wind_down: "Reduzierte Intensität (Bridge-14)",
  same_kind_cooldown: "Cooldown (30 Min.)",
  daily_cap: "Tageslimit (max. 3)",
  max_per_day: "Tageslimit (max. 3)",
};

function whyText(r: Row): string {
  if (r.state === "suppressed") {
    const k = r.suppression_reason ?? "unknown";
    return REASON_LABEL[k] ?? `Unterdrückt: ${k}`;
  }
  if (r.kind === "rescue") return "Lernziel kurz vor dem Verlust — kurzer Auffrischer empfohlen.";
  if (r.kind === "exam_countdown") return "Deine Prüfungsphase nähert sich.";
  if (r.kind === "weak_competency") return "Erkannte Lücke in einer Kernkompetenz.";
  if (r.kind === "streak_recovery") return "Sanfte Erinnerung — kein Druck, nur Empfehlung.";
  if (r.kind === "readiness_summary") return "Wöchentliche Readiness-Zusammenfassung.";
  return "Empfehlung deiner Lernsteuerung.";
}

export default function LearnerNotificationHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("learner_get_recent_notifications", { p_limit: 20 });
      setRows((data as Row[]) ?? []);
    })();
  }, []);

  if (!rows) return null;
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Letzte Erinnerungen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Noch keine Erinnerungen gesendet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Letzte Erinnerungen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const ts = r.delivered_at ?? r.scheduled_for;
          return (
            <div key={r.job_id} className="rounded-md border p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <div className="flex gap-1">
                  {r.state === "delivered" && <Badge variant="outline" className="text-[10px]">Zugestellt</Badge>}
                  {r.state === "suppressed" && <Badge variant="secondary" className="text-[10px]">Unterdrückt</Badge>}
                  {r.state === "failed" && <Badge variant="destructive" className="text-[10px]">Fehlgeschlagen</Badge>}
                  {r.state === "pending" && <Badge variant="outline" className="text-[10px]">Eingeplant</Badge>}
                  {r.was_opened && <Badge className="text-[10px]">Geöffnet</Badge>}
                </div>
              </div>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Warum:</span> {whyText(r)}
              </p>
              <p className="text-muted-foreground">
                {ts ? formatDistanceToNow(new Date(ts), { addSuffix: true, locale: de }) : "—"}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
