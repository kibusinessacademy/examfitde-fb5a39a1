import { Helmet } from "react-helmet-async";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, AlertTriangle, CheckCircle2, Calendar, Clock, Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getProgramBySlug } from "@/lib/foerdermittel/registry";
import { REGION_LABEL } from "@/lib/foerdermittel/matching";
import { FreshnessBadge } from "@/components/foerdermittel/FreshnessBadge";
import { ApplicationRoadmapCard } from "@/components/foerdermittel/ApplicationRoadmapCard";
import {
  classifyFreshness,
  classifyChangeRisk,
  explainFreshness,
  CHANGE_RISK_LABEL,
} from "@/lib/foerdermittel/freshness";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default function FoerdermittelProgramPage() {
  const { slug } = useParams<{ slug: string }>();
  const program = slug ? getProgramBySlug(slug) : undefined;
  if (!program) return <Navigate to="/foerdermittel" replace />;

  const max = program.funding.amountEurMax;
  const min = program.funding.amountEurMin;
  const rate =
    program.funding.ratePctMax && program.funding.ratePctMin
      ? `${program.funding.ratePctMin}–${program.funding.ratePctMax} %`
      : program.funding.ratePctMax
        ? `bis ${program.funding.ratePctMax} %`
        : null;

  const statusLabel: Record<string, { label: string; tone: string }> = {
    active: { label: "Aktiv", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    paused: { label: "Pausiert", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    upcoming: { label: "Wiederauflage", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
    depleted: { label: "Topf ausgeschöpft", tone: "bg-orange-500/15 text-orange-700" },
    expired: { label: "Beendet", tone: "bg-destructive/15 text-destructive" },
  };
  const st = statusLabel[program.status];

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{program.name} · Antrag, Unterlagen, Fristen · FördermittelOS</title>
        <meta
          name="description"
          content={`${program.shortDescription} Antragsfahrplan, Checkliste, Pflichtdokumente und Fristen für ${program.name}.`}
        />
        <link rel="canonical" href={`https://berufos.com/foerdermittel/programm/${program.slug}`} />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "GovernmentService",
            name: program.name,
            description: program.shortDescription,
            provider: { "@type": "GovernmentOrganization", name: program.authority },
            areaServed: program.region,
          })}
        </script>
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Alle Programme
        </Link>
      </section>

      <section className="mx-auto max-w-5xl px-6 pt-2 pb-8">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="outline">{program.authority}</Badge>
          <Badge variant="outline">{REGION_LABEL[program.region] ?? program.region}</Badge>
          <Badge variant="secondary" className="capitalize">{program.kind}</Badge>
          <span className={`text-xs px-2 py-0.5 rounded-full ${st.tone}`}>{st.label}</span>
          <FreshnessBadge status={classifyFreshness(program)} />
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{program.name}</h1>
        <p className="mt-3 text-lg text-muted-foreground max-w-3xl">{program.shortDescription}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {program.topics.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px] capitalize">{t}</Badge>
          ))}
        </div>
      </section>

      {/* Cut 2 — Freshness & Change Risk explainability */}
      <section className="mx-auto max-w-5xl px-6 pb-8">
        <Card className="border-primary/20">
          <CardContent className="p-5">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Aktualität &amp; Änderungsrisiko</h2>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <FreshnessBadge status={classifyFreshness(program)} />
                <span className="text-[11px] text-muted-foreground">
                  Änderungsrisiko: <strong>{CHANGE_RISK_LABEL[classifyChangeRisk(program)]}</strong>
                </span>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5 text-sm">
              {explainFreshness(program).map((line) => (
                <li key={line} className="flex items-start gap-2 text-muted-foreground">
                  <span className="text-primary">›</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {program.freshness?.lastVerifiedAt && (
              <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded border p-2">
                  <div className="text-muted-foreground">Letzte Verifikation</div>
                  <div className="font-medium">
                    {new Date(program.freshness.lastVerifiedAt).toLocaleDateString("de-DE")}
                  </div>
                </div>
                {program.freshness.nextReviewAt && (
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Nächste Prüfung</div>
                    <div className="font-medium">
                      {new Date(program.freshness.nextReviewAt).toLocaleDateString("de-DE")}
                    </div>
                  </div>
                )}
                {program.freshness.updateCadence && (
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Update-Rhythmus</div>
                    <div className="font-medium capitalize">{program.freshness.updateCadence}</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-10 grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Förderhöhe</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {max ? eur(max) : "—"}
            </div>
            {min && <div className="text-xs text-muted-foreground">ab {eur(min)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Förderquote</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{rate ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Bewilligungsdauer</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {program.decisionWeeks ? `~ ${program.decisionWeeks} Wochen` : "—"}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-12 grid gap-6 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Voraussetzungen</h2>
            <ul className="space-y-2 text-sm">
              {program.requirements.map((r) => (
                <li key={r.key} className="flex items-start gap-2">
                  {r.hard ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  )}
                  <span>
                    {r.label}
                    {r.hard && <Badge variant="outline" className="ml-2 text-[9px]">Hart</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Benötigte Dokumente</h2>
            <ul className="space-y-1.5 text-sm">
              {program.documentsNeeded.map((d) => (
                <li key={d} className="flex items-start gap-2">
                  <span className="text-muted-foreground">›</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {(program.combinableWith?.length || program.notCombinableWith?.length) && (
          <Card className="md:col-span-2">
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Kombinierbarkeit</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {program.combinableWith && program.combinableWith.length > 0 && (
                  <div>
                    <div className="text-xs text-emerald-600 mb-1">Kombinierbar mit</div>
                    <ul className="text-sm space-y-1">
                      {program.combinableWith.map((c) => (
                        <li key={c}>
                          <Link to={`/foerdermittel/programm/${c}`} className="text-primary hover:underline">
                            {c}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {program.notCombinableWith && program.notCombinableWith.length > 0 && (
                  <div>
                    <div className="text-xs text-destructive mb-1">Nicht kombinierbar mit</div>
                    <ul className="text-sm space-y-1">
                      {program.notCombinableWith.map((c) => (<li key={c}>{c}</li>))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="md:col-span-2">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Quellen & Verifikation
            </h2>
            <ul className="space-y-2 text-sm">
              {program.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {s.label} <ExternalLink className="h-3 w-3" />
                  </a>
                  {s.lastVerifiedAt && (
                    <span className="text-xs text-muted-foreground ml-2">
                      verifiziert {new Date(s.lastVerifiedAt).toLocaleDateString("de-DE")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground border-t pt-3">
              Hinweis: Angaben werden laufend aktualisiert, ersetzen aber keine verbindliche
              Förderberatung. Maßgeblich sind die Richtlinien der Förderstelle.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Cut 3 — Execution OS: Antragsfahrplan */}
      <ApplicationRoadmapCard program={program} />
    </main>
  );
}
