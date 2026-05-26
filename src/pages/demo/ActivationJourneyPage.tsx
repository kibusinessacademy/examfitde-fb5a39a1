/**
 * /demo/journey — Activation Journey: Risk → Cause → Intervention → Effect → Outcome.
 * Die zentrale Produktstory in 5 Schritten.
 */
import { useSearchParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, ArrowRight, AlertTriangle, Search, Wrench, Activity, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type Stage = "risk" | "cause" | "intervention" | "effect" | "outcome";

const STAGES: { id: Stage; label: string; icon: typeof AlertTriangle }[] = [
  { id: "risk", label: "Risiko sehen", icon: AlertTriangle },
  { id: "cause", label: "Ursache verstehen", icon: Search },
  { id: "intervention", label: "Intervention", icon: Wrench },
  { id: "effect", label: "Wirkung messen", icon: Activity },
  { id: "outcome", label: "Outcome", icon: Trophy },
];

export default function ActivationJourneyPage() {
  const [params, setParams] = useSearchParams();
  const stage = (params.get("stage") as Stage) || "risk";
  const idx = STAGES.findIndex((s) => s.id === stage);
  const next = STAGES[idx + 1];
  const prev = STAGES[idx - 1];

  const setStage = (s: Stage) => setParams({ stage: s });

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Activation Journey · BerufsKI Live-Demo</title>
        <meta name="description" content="Risk → Cause → Intervention → Effect → Outcome — die BerufsKI-Produktstory in 5 Schritten." />
      </Helmet>

      <section className="mx-auto max-w-4xl px-6 pt-10 pb-6">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/demo"><ArrowLeft className="mr-2 h-4 w-4" /> Alle Demos</Link>
        </Button>
        <Badge variant="secondary">Activation Journey · 5 Schritte</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Die BerufsKI-Story in 5 Schritten.</h1>
        <p className="mt-2 text-muted-foreground">Vom Risiko zum messbaren Outcome — keine Folie ist ein Zufall.</p>

        <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-2">
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const isActive = s.id === stage;
            const isDone = i < idx;
            return (
              <button
                key={s.id}
                onClick={() => setStage(s.id)}
                className={
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors " +
                  (isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : isDone
                    ? "border-success bg-success/10"
                    : "border-border bg-background hover:bg-muted")
                }
              >
                <Icon className="h-3.5 w-3.5" /> {i + 1}. {s.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-10">
        {stage === "risk" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Risiko sehen</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-destructive">Risiko 82</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Marius K., FISI Frühjahr 2026 — kritisch für AP2.
              </p>
              <div className="mt-4 rounded-md border bg-destructive/5 p-3 text-sm">
                <strong>Headline-Signal:</strong> Risikoscore in 14 Tagen +18 Punkte gestiegen.
              </div>
            </CardContent>
          </Card>
        )}

        {stage === "cause" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Ursache verstehen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Konkrete Kompetenzlücken — keine vagen Lernpläne.</p>
              <div>
                <div className="flex justify-between text-sm"><span>LF7 Routing-Protokolle</span><span>34%</span></div>
                <Progress value={34} className="mt-1" />
              </div>
              <div>
                <div className="flex justify-between text-sm"><span>LF9 IT-Sicherheit</span><span>48%</span></div>
                <Progress value={48} className="mt-1" />
              </div>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <strong>Driver:</strong> Routing-Protokolle nicht gemeistert · 3 Wiederholungs-Fails in Recovery.
              </div>
            </CardContent>
          </Card>
        )}

        {stage === "intervention" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Intervention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Vorgeschlagene Maßnahmen — ein Klick startet.</p>
              <div className="rounded-md border p-3"><strong>1.</strong> Recovery-Set LF7 — 12 fokussierte Aufgaben</div>
              <div className="rounded-md border p-3"><strong>2.</strong> Tutor-Session „Routing-Vertiefung" (45 min)</div>
              <div className="rounded-md border p-3"><strong>3.</strong> Workflow „Netzwerk-Konzept entwerfen"</div>
              <Button className="mt-2 w-full" disabled>Maßnahmenpaket starten (Demo)</Button>
            </CardContent>
          </Card>
        )}

        {stage === "effect" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Wirkung messen</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-success-foreground">+22%</p>
              <p className="mt-1 text-sm text-muted-foreground">Recovery-Lift LF7 nach 14 Tagen</p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Risikoscore</span><span className="font-semibold">82 → 58</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Mastery LF7</span><span className="font-semibold">34% → 56%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tutor-Engagement</span><span className="font-semibold">+3 Sessions/Wo</span></div>
              </div>
            </CardContent>
          </Card>
        )}

        {stage === "outcome" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-primary" /> Outcome</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">81% Prüfungswahrscheinlichkeit</p>
              <p className="mt-1 text-sm text-muted-foreground">+7 Punkte gegenüber Start — Konfidenz: hoch</p>
              <div className="mt-4 rounded-md border bg-primary/5 p-3 text-sm">
                <strong>Story:</strong> Risiko erkannt → Ursache identifiziert → Maßnahme gesetzt → Wirkung gemessen → Outcome verbessert.
                Das ist BerufsKI — deterministisch, evidenzbasiert, auditierbar.
              </div>
              <div className="mt-4 flex gap-2">
                <Button asChild><Link to="/suites">Suiten ansehen</Link></Button>
                <Button asChild variant="outline"><Link to="/enterprise-demo">Live-Demo buchen</Link></Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={!prev} onClick={() => prev && setStage(prev.id)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {prev?.label ?? ""}
          </Button>
          <Button disabled={!next} onClick={() => next && setStage(next.id)}>
            {next?.label ?? "Fertig"} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>
    </main>
  );
}
