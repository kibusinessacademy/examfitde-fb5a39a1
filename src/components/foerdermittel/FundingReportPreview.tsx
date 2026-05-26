import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, AlertTriangle, CheckCircle2, Radar, Layers } from "lucide-react";
import type { FundingReportSummary } from "@/lib/foerdermittel/conversion";

interface Props {
  report: FundingReportSummary;
}

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function FundingReportPreview({ report }: Props) {
  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Geschätztes Förder-Volumen</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {report.estimatedTotalEur.max > 0
                ? `${eur(report.estimatedTotalEur.min)} – ${eur(report.estimatedTotalEur.max)}`
                : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Passende Programme</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{report.topMatches.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Aktualitätsrisiken</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{report.freshnessRisks.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 space-y-1">
            {report.warnings.map((w) => (
              <div key={w} className="text-sm text-amber-800 dark:text-amber-300 inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> {w}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Top matches */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-base font-semibold mb-3 inline-flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Top-Förderungen
          </h2>
          {report.topMatches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Programme im aktuellen Profil — Profil verfeinern.</p>
          ) : (
            <ul className="divide-y">
              {report.topMatches.map((m) => (
                <li key={m.slug} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Link to={`/foerdermittel/programm/${m.slug}`} className="font-medium text-sm hover:underline truncate block">
                      {m.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-2">
                      <span>Fit {m.fit}</span>
                      <span>·</span>
                      <span>Bewilligungs­wahrscheinlichkeit {m.probability}%</span>
                      <span>·</span>
                      <Badge variant="outline" className="text-[9px] capitalize">{m.freshness}</Badge>
                    </div>
                  </div>
                  <Link to={`/foerdermittel/programm/${m.slug}`} className="text-xs text-primary inline-flex items-center gap-1">
                    Roadmap <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Missing docs + next actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-2">Pflichtdokumente (Top-Programm)</h3>
            {report.missingDocumentsTop.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Dokumente hinterlegt.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.missingDocumentsTop.map((d) => (
                  <li key={d} className="flex items-start gap-2">
                    <span className="text-muted-foreground">›</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-2">Nächste beste Aktionen</h3>
            <ul className="space-y-1.5 text-sm">
              {report.nextBestActions.map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Freshness risks */}
      {report.freshnessRisks.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-2">
              <Radar className="h-4 w-4 text-amber-600" /> Aktualitätsrisiken
            </h3>
            <ul className="space-y-1.5 text-sm">
              {report.freshnessRisks.map((r) => (
                <li key={r.slug} className="flex items-start gap-2">
                  <span className="text-muted-foreground">›</span>
                  <span>
                    <Link to={`/foerdermittel/programm/${r.slug}`} className="text-primary hover:underline">
                      {r.slug}
                    </Link>{" "}
                    — {r.reason}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
