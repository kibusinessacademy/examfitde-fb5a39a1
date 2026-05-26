import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Radar, ShieldCheck, AlertTriangle, HelpCircle, ArrowRight } from "lucide-react";
import { FreshnessBadge } from "./FreshnessBadge";
import type { Program } from "@/lib/foerdermittel/types";
import {
  rankProgramsByReviewUrgency,
  summarizeProgramFreshness,
  CHANGE_RISK_LABEL,
} from "@/lib/foerdermittel/freshness";

export function FoerderRadarCard({ programs }: { programs: Program[] }) {
  const summary = summarizeProgramFreshness(programs);
  const top = rankProgramsByReviewUrgency(programs).filter((e) => e.urgency > 0).slice(0, 5);

  const kpi: { key: string; label: string; value: number; tone: string; Icon: typeof Radar }[] = [
    { key: "fresh", label: "Aktuell", value: summary.fresh, tone: "text-emerald-600", Icon: ShieldCheck },
    { key: "watch", label: "Beobachten", value: summary.watch, tone: "text-amber-600", Icon: Radar },
    { key: "stale", label: "Prüfen", value: summary.stale, tone: "text-orange-600", Icon: AlertTriangle },
    { key: "unknown", label: "Unbekannt", value: summary.unknown, tone: "text-muted-foreground", Icon: HelpCircle },
  ];

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-background to-muted/30">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Radar className="h-4 w-4 text-primary" />
              <span className="text-xs uppercase tracking-wider text-primary font-semibold">
                FörderRadar
              </span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Aktualitäts- &amp; Änderungs-Monitoring
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Förderbedingungen ändern sich laufend — wir markieren Aktualitätsrisiken transparent
              und priorisieren Programme mit Prüfbedarf.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums leading-none">
              {summary.needsReview}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Programme mit Prüfbedarf
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpi.map((k) => (
            <div key={k.key} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <k.Icon className={`h-3.5 w-3.5 ${k.tone}`} />
                {k.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</div>
            </div>
          ))}
        </div>

        {top.length > 0 && (
          <div className="mt-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Top {top.length} mit Prüfbedarf
            </div>
            <ul className="divide-y rounded-lg border bg-card">
              {top.map((e) => (
                <li key={e.program.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/foerdermittel/programm/${e.program.slug}`}
                        className="font-medium text-sm hover:underline truncate"
                      >
                        {e.program.name}
                      </Link>
                      <FreshnessBadge status={e.status} size="xs" />
                      <span className="text-[10px] text-muted-foreground">
                        Risiko: {CHANGE_RISK_LABEL[e.risk]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.reason}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{e.urgency}</div>
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      Urgency
                    </div>
                  </div>
                  <Link
                    to={`/foerdermittel/programm/${e.program.slug}`}
                    className="text-primary"
                    aria-label={`Details ${e.program.name}`}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-4 text-[11px] text-muted-foreground border-t pt-3">
          Hinweis: Klassifikation rein deterministisch aus Quellen-Metadaten. Keine Live-Crawler,
          keine generative KI. Maßgeblich bleibt die offizielle Quelle der Förderstelle.
        </p>
      </CardContent>
    </Card>
  );
}
