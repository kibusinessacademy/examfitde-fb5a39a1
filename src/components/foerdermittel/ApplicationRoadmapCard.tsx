// FördermittelOS Cut 3 — Premium "Antragsfahrplan" block on program detail page.
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  Target,
  TimerReset,
  Workflow,
  Zap,
} from "lucide-react";
import type { Program } from "@/lib/foerdermittel/types";
import {
  buildApplicationTimeline,
  buildDocumentChecklist,
  buildNextBestActions,
  computeApplicationReadiness,
  rankApplicationRisks,
  toDocKey,
  PRIORITY_LABEL,
  VERDICT_LABEL,
  VERDICT_TONE,
  type ApplicationRisk,
} from "@/lib/foerdermittel/execution";

interface Props {
  program: Program;
}

export function ApplicationRoadmapCard({ program }: Props) {
  const [presentDocs, setPresentDocs] = useState<Set<string>>(new Set());
  const [metReqs, setMetReqs] = useState<Set<string>>(
    () => new Set(program.requirements.filter((r) => !r.hard).map((r) => r.key)),
  );

  const readiness = useMemo(
    () => computeApplicationReadiness(program, undefined, presentDocs, metReqs),
    [program, presentDocs, metReqs],
  );
  const checklist = useMemo(() => buildDocumentChecklist(program, presentDocs), [program, presentDocs]);
  const risks = useMemo(
    () => rankApplicationRisks(program, undefined, presentDocs, metReqs),
    [program, presentDocs, metReqs],
  );
  const actions = useMemo(
    () => buildNextBestActions(program, readiness, presentDocs),
    [program, readiness, presentDocs],
  );
  const timeline = useMemo(() => buildApplicationTimeline(program), [program]);

  const totalWeeks = timeline.reduce((s, t) => s + t.estimateWeeks, 0);

  const toggleDoc = (key: string) =>
    setPresentDocs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleReq = (key: string) =>
    setMetReqs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <section className="mx-auto max-w-5xl px-6 pb-10">
      <Card className="border-primary/30 shadow-elev-2">
        <CardContent className="p-6">
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Workflow className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider font-semibold">Execution OS</span>
              </div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">Antragsfahrplan</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Von „passend“ zu „eingereicht“. Deterministischer Pfad, keine Black-Box.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <ReadinessRing score={readiness.score} />
              <div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${VERDICT_TONE[readiness.verdict]}`}
                >
                  {VERDICT_LABEL[readiness.verdict]}
                </span>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Ø Dauer: ~ {totalWeeks} Wochen
                </div>
              </div>
            </div>
          </header>

          {/* Breakdown */}
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {[
              { k: "documents" as const, label: "Dokumente" },
              { k: "requirements" as const, label: "Voraussetzungen" },
              { k: "timing" as const, label: "Timing" },
              { k: "sourceFreshness" as const, label: "Quellen-Aktualität" },
            ].map((r) => (
              <div key={r.k} className="rounded-lg border p-3">
                <div className="text-[11px] text-muted-foreground">{r.label}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-lg font-semibold tabular-nums">
                    {readiness.breakdown[r.k]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">/100</span>
                </div>
                <Progress value={readiness.breakdown[r.k]} className="h-1 mt-2" />
              </div>
            ))}
          </div>

          {/* Next Best Actions */}
          {actions.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Nächste beste Aktionen
              </h3>
              <ul className="mt-3 space-y-2">
                {actions.slice(0, 5).map((a) => (
                  <li
                    key={a.key}
                    className="flex items-start gap-3 rounded-lg border p-3 hover:border-primary/40 transition"
                  >
                    <Badge
                      variant={a.priority === "now" ? "default" : "outline"}
                      className="text-[10px] uppercase tracking-wider"
                    >
                      {PRIORITY_LABEL[a.priority]}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{a.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{a.reason}</div>
                    </div>
                    {a.bridge && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        → {a.bridge.os}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Document Checklist */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" /> Dokumentencheck
              </h3>
              <ul className="mt-3 space-y-2">
                {checklist.map((d) => (
                  <li key={d.key} className="flex items-start gap-2.5 text-sm">
                    <Checkbox
                      checked={presentDocs.has(d.key)}
                      onCheckedChange={() => toggleDoc(d.key)}
                      className="mt-0.5"
                      aria-label={`${d.label} vorhanden`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={presentDocs.has(d.key) ? "line-through text-muted-foreground" : ""}>
                          {d.label}
                        </span>
                        {d.critical && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600">
                            Pflicht
                          </Badge>
                        )}
                      </div>
                      {!presentDocs.has(d.key) && d.note && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{d.note}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Requirements */}
            <div>
              <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Voraussetzungen bestätigen
              </h3>
              <ul className="mt-3 space-y-2">
                {program.requirements.map((r) => (
                  <li key={r.key} className="flex items-start gap-2.5 text-sm">
                    <Checkbox
                      checked={metReqs.has(r.key)}
                      onCheckedChange={() => toggleReq(r.key)}
                      className="mt-0.5"
                      aria-label={`${r.label} erfüllt`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={metReqs.has(r.key) ? "line-through text-muted-foreground" : ""}>
                          {r.label}
                        </span>
                        {r.hard && (
                          <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">
                            Hart
                          </Badge>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Risks */}
          {risks.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Risiko-Hinweise
              </h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {risks.map((r) => (
                  <RiskRow key={r.key} risk={r} />
                ))}
              </ul>
            </div>
          )}

          {/* Timeline */}
          <div className="mt-8">
            <h3 className="text-sm font-semibold inline-flex items-center gap-2">
              <TimerReset className="h-4 w-4 text-primary" /> Antragstimeline
            </h3>
            <ol className="mt-4 relative border-l-2 border-border ml-3 space-y-4">
              {timeline.map((s, i) => (
                <li key={s.key} className="pl-5 relative">
                  <span className="absolute -left-[9px] top-1 h-4 w-4 rounded-full bg-background border-2 border-primary inline-flex items-center justify-center">
                    <span className="text-[9px] font-semibold tabular-nums text-primary">{i + 1}</span>
                  </span>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.label}</span>
                    <span className="text-[11px] text-muted-foreground">~ {s.estimateWeeks} Wo.</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                  {s.bridgeOS && (
                    <Badge variant="secondary" className="text-[10px] mt-1.5">
                      Bridge → {s.bridgeOS}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground border-t pt-3">
            Hinweis: Der Antragsfahrplan ist ein deterministisches Hilfsmittel und ersetzt keine
            verbindliche Förderberatung. Maßgeblich sind die Richtlinien der jeweiligen Förderstelle.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function RiskRow({ risk }: { risk: ApplicationRisk }) {
  const tone =
    risk.severity === "high"
      ? "border-destructive/40 bg-destructive/5"
      : risk.severity === "medium"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-border bg-muted/30";
  return (
    <li className={`rounded-lg border p-3 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={`h-3.5 w-3.5 mt-0.5 ${risk.severity === "high" ? "text-destructive" : risk.severity === "medium" ? "text-amber-500" : "text-muted-foreground"}`}
        />
        <div>
          <div className="font-medium">{risk.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{risk.hint}</div>
        </div>
      </div>
    </li>
  );
}

function ReadinessRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  return (
    <div className="relative h-16 w-16">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold tabular-nums leading-none">{score}</span>
        <span className="text-[8px] text-muted-foreground uppercase tracking-wider">Readiness</span>
      </div>
    </div>
  );
}

// Stub for unused import elision
void Circle;
void CheckCircle2;
