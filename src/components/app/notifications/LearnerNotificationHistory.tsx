import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, Info } from "lucide-react";
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

type Intent = {
  intent_key: string;
  label: string;
  description: string;
  trigger_reason: string;
  recovery_action: string;
  max_per_day: number;
  respects_quiet_hours: boolean;
  respects_fatigue: boolean;
};

const REASON_LABEL: Record<string, string> = {
  channel_optout: "Kanal deaktiviert",
  quiet_hours: "Ruhezeit",
  fatigue_suppress: "Erschöpfungsschutz",
  wind_down: "Reduzierte Intensität (Bridge-14)",
  same_kind_cooldown: "Cooldown (30 Min.)",
  daily_cap: "Tageslimit",
  max_per_day: "Tageslimit",
};

export default function LearnerNotificationHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [registry, setRegistry] = useState<Record<string, Intent>>({});

  useEffect(() => {
    (async () => {
      const [{ data: rs }, { data: reg }] = await Promise.all([
        (supabase as any).rpc("learner_get_recent_notifications", { p_limit: 20 }),
        (supabase as any).rpc("learner_get_intent_registry"),
      ]);
      setRows((rs as Row[]) ?? []);
      const map: Record<string, Intent> = {};
      ((reg as Intent[]) ?? []).forEach((i) => { map[i.intent_key] = i; });
      setRegistry(map);
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
          const intent = registry[r.kind];
          const label = intent?.label ?? r.kind;

          let why: string;
          if (r.state === "suppressed") {
            const k = r.suppression_reason ?? "unknown";
            why = REASON_LABEL[k] ?? `Unterdrückt: ${k}`;
          } else if (intent) {
            why = intent.trigger_reason || intent.description;
          } else {
            why = "Empfehlung deiner Lernsteuerung.";
          }

          return (
            <div key={r.job_id} className="rounded-md border p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{label}</span>
                <div className="flex gap-1">
                  {r.state === "delivered" && <Badge variant="outline" className="text-[10px]">Zugestellt</Badge>}
                  {r.state === "suppressed" && <Badge variant="secondary" className="text-[10px]">Unterdrückt</Badge>}
                  {r.state === "failed" && <Badge variant="destructive" className="text-[10px]">Fehlgeschlagen</Badge>}
                  {r.state === "pending" && <Badge variant="outline" className="text-[10px]">Eingeplant</Badge>}
                  {r.was_opened && <Badge className="text-[10px]">Geöffnet</Badge>}
                </div>
              </div>
              <p className="text-muted-foreground flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span><span className="font-medium text-foreground">Warum bekomme ich das?</span> {why}</span>
              </p>
              {intent && (
                <p className="text-muted-foreground text-[10px]">
                  Max. {intent.max_per_day}/Tag · {intent.respects_quiet_hours ? "Ruhezeit aktiv" : "ignoriert Ruhezeit"} ·
                  {intent.respects_fatigue ? " Fatigue-Schutz" : " ohne Fatigue-Schutz"}
                </p>
              )}
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
