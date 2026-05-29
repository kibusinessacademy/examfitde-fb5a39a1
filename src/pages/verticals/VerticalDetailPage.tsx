import { useParams, Navigate, Link, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getVertical, VERTICAL_INDUSTRY_KEY, type VerticalSlug } from "@/data/verticals";
import { VERTICAL_TIERS, type VerticalTier } from "@/config/verticalPricing";
import {
  getVerticalOccupationalDna,
  type VerticalOccupationalDna,
} from "@/lib/berufs-ki/occupational-intelligence";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowLeft, Shield, AlertCircle, Layers } from "lucide-react";
import { VerwaltungDepartmentsSection } from "@/components/verticals/VerwaltungDepartmentsSection";
import { VerwaltungBundLagebildSection } from "@/components/verticals/VerwaltungBundLagebildSection";
import { VerwaltungArbeitsmarktSection } from "@/components/verticals/VerwaltungArbeitsmarktSection";
import { toast } from "sonner";
import { PublicHubLayout } from "@/components/berufos/PublicHubLayout";

export default function VerticalDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const vertical = slug ? getVertical(slug) : undefined;
  const [loadingTier, setLoadingTier] = useState<VerticalTier | null>(null);
  const [dna, setDna] = useState<VerticalOccupationalDna | null>(null);

  useEffect(() => {
    if (!vertical) return;
    let alive = true;
    getVerticalOccupationalDna(vertical.slug).then((d) => { if (alive) setDna(d); });
    return () => { alive = false; };
  }, [vertical?.slug]);

  if (!vertical) return <Navigate to="/branchen" replace />;
  const industryKey = VERTICAL_INDUSTRY_KEY[vertical.slug as VerticalSlug];

  const checkoutStatus = searchParams.get("checkout");

  const handleSubscribe = async (tier: VerticalTier) => {
    if (tier === "enterprise") {
      window.location.href = `mailto:sales@berufos.com?subject=BerufOS%20${encodeURIComponent(vertical.brand)}%20Enterprise%20Anfrage`;
      return;
    }
    setLoadingTier(tier);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        toast.error("Bitte zuerst einloggen, um zu abonnieren.");
        window.location.href = `/auth?redirect=${encodeURIComponent(`/branchen/${vertical.slug}`)}`;
        return;
      }
      const { data, error } = await supabase.functions.invoke("create-vertical-checkout", {
        body: { vertical_slug: vertical.slug, tier },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("Keine Checkout-URL erhalten");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout konnte nicht gestartet werden");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{`${vertical.brand} — ${vertical.tagline}`}</title>
        <meta name="description" content={vertical.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/branchen/${vertical.slug}`} />
      </Helmet>

      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <Link to="/branchen" className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-text-1">
          <ArrowLeft className="h-4 w-4" /> Alle Branchen
        </Link>
      </div>

      {/* HERO */}
      <section className="border-b border-border bg-surface-1">
        <div className="container mx-auto px-4 py-12 md:py-20 max-w-5xl">
          <div className="text-5xl mb-4">{vertical.emoji}</div>
          <Badge variant="outline" className="mb-3">EU-gehostet · DSGVO · AI-Act-ready</Badge>
          <h1 className="text-3xl md:text-5xl font-bold text-text-1 mb-4">{vertical.brand}</h1>
          <p className="text-xl text-text-2 mb-4">{vertical.tagline}</p>
          <p className="text-text-3">{vertical.audience}</p>
        </div>
      </section>

      {checkoutStatus === "success" && (
        <div className="container mx-auto px-4 pt-6 max-w-5xl">
          <div className="rounded-lg border border-success/40 bg-status-bg-subtle p-4 text-sm text-text-1">
            Checkout abgeschlossen. Deine Subscription wird in den nächsten Minuten aktiviert.
          </div>
        </div>
      )}
      {checkoutStatus === "canceled" && (
        <div className="container mx-auto px-4 pt-6 max-w-5xl">
          <div className="rounded-lg border border-border bg-surface-2 p-4 text-sm text-text-2 inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Checkout abgebrochen — du kannst es jederzeit erneut starten.
          </div>
        </div>
      )}

      {/* PAIN POINTS */}
      <section className="container mx-auto px-4 py-12 max-w-5xl">
        <h2 className="text-2xl font-bold text-text-1 mb-2">Was {vertical.brand} dir abnimmt</h2>
        <p className="text-text-2 mb-6">Die typischen Belastungen deiner Branche — automatisiert oder vorbereitet.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vertical.painPoints.map((p) => (
            <div key={p} className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-4">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <span className="text-text-1">{p}</span>
            </div>
          ))}
        </div>
      </section>

      {/* WORKFLOWS */}
      <section className="container mx-auto px-4 py-8 max-w-5xl">
        <h2 className="text-2xl font-bold text-text-1 mb-2">Beispielhafte Vorgänge</h2>
        <p className="text-text-2 mb-6">Jeder dieser Workflows zählt als ein "intelligenter Vorgang" gegen dein Monats-Limit.</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {vertical.exampleWorkflows.map((w) => (
            <li key={w} className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-text-1">
              {w}
            </li>
          ))}
        </ul>
      </section>

      {/* STRUKTURIERTE BERUFS-DNA — Bridge auf bestehende SSOT (Curricula/Lernfelder/Kompetenzen) */}
      {dna && dna.summary && (dna.summary.certifications_count ?? 0) > 0 && (
        <section className="border-t border-border bg-surface-1">
          <div className="container mx-auto px-4 py-12 max-w-5xl">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-bold text-text-1">Strukturierte Berufs-DNA</h2>
            </div>
            <p className="text-text-2 mb-6">
              {vertical.brand} arbeitet auf der zertifizierten Berufsstruktur der Branche
              (Berufsbilder · Lernfelder · Kompetenzen). Kein generisches Modell-Wissen — sondern Berufsgrammatik.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              {[
                { label: "Berufszertifikate", value: dna.summary.certifications_count ?? 0 },
                { label: "Berufsbilder", value: dna.summary.curricula_count ?? 0 },
                { label: "Lernfelder", value: dna.summary.learning_fields_count ?? 0 },
                { label: "Kompetenzen", value: dna.summary.competencies_count ?? 0 },
                { label: "Prüfungs-Blueprints", value: dna.summary.blueprints_count ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-surface-2 p-4">
                  <div className="text-2xl font-bold text-text-1">{(s.value as number).toLocaleString("de-DE")}</div>
                  <div className="text-xs text-text-3 mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {dna.certifications.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Verankerte Berufszertifikate</h3>
                <div className="flex flex-wrap gap-2">
                  {dna.certifications.slice(0, 12).map((c) => (
                    <Badge key={c.id} variant="outline" className="font-normal">{c.title}</Badge>
                  ))}
                  {dna.certifications.length > 12 && (
                    <Badge variant="outline" className="font-normal">+{dna.certifications.length - 12} weitere</Badge>
                  )}
                </div>
              </div>
            )}

            {/* Berufsrealität: Prozesse / Workflow-Typen / Outcomes / Personas / Eskalationen */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
              {dna.vertical.processes?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Kernprozesse</h3>
                  <ul className="space-y-1.5">
                    {dna.vertical.processes.slice(0, 8).map((p) => (
                      <li key={p.key} className="text-sm text-text-1 flex gap-2"><span className="text-primary">·</span>{p.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {dna.vertical.workflow_types?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Workflow-Typen</h3>
                  <ul className="space-y-1.5">
                    {dna.vertical.workflow_types.slice(0, 8).map((w) => (
                      <li key={w.key} className="text-sm text-text-1 flex gap-2"><span className="text-primary">·</span>{w.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {dna.vertical.outcomes?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Outcome-Typen</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {dna.vertical.outcomes.map((o) => (
                      <Badge key={o.key} variant="secondary" className="font-normal">{o.label}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {dna.vertical.persona_seeds?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Persona-Beispiele</h3>
                  <ul className="space-y-2">
                    {dna.vertical.persona_seeds.slice(0, 4).map((p) => (
                      <li key={p.key} className="text-sm">
                        <div className="text-text-1 font-medium">{p.label}</div>
                        {typeof p.context === "string" && (
                          <div className="text-text-3 text-xs">{p.context}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {dna.vertical.escalations?.length > 0 && (
                <div className="md:col-span-2">
                  <h3 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Strukturierte Eskalations-Pfade</h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {dna.vertical.escalations.slice(0, 6).map((e) => (
                      <li key={e.key} className="text-sm rounded-md border border-border bg-surface-2 px-3 py-2">
                        <div className="text-text-1">{e.label}</div>
                        {typeof e.route === "string" && (
                          <div className="text-text-3 text-xs mt-0.5">→ {e.route}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Operative Berufsintelligenz — KPI / Communication / Decision / Document Models */}
            {(dna.vertical.kpi_models?.length > 0 ||
              dna.vertical.communication_models?.length > 0 ||
              dna.vertical.decision_models?.length > 0 ||
              dna.vertical.document_intelligence?.length > 0) && (
              <div className="mt-10 pt-8 border-t border-border">
                <h3 className="text-lg font-semibold text-text-1 mb-1">Operative Berufsintelligenz</h3>
                <p className="text-text-3 text-sm mb-6">
                  Strukturierte Modelle für Outcomes, Kommunikation, Entscheidungen und Dokumentlogik —
                  Fundament für DailyBrief, Persona-Simulation, Governance und Document-Workflows.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {dna.vertical.kpi_models?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">KPI-Modelle</h4>
                      <ul className="space-y-2">
                        {dna.vertical.kpi_models.slice(0, 6).map((k) => (
                          <li key={k.key} className="text-sm rounded-md border border-border bg-surface-2 px-3 py-2">
                            <div className="text-text-1 font-medium">{k.label}</div>
                            {typeof k.target === "string" && (
                              <div className="text-text-3 text-xs mt-0.5">Ziel: {k.target}</div>
                            )}
                            {typeof k.risk === "string" && (
                              <div className="text-text-3 text-xs">Risiko: {k.risk}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dna.vertical.communication_models?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Kommunikations-Modelle</h4>
                      <ul className="space-y-2">
                        {dna.vertical.communication_models.slice(0, 6).map((c) => (
                          <li key={c.key} className="text-sm rounded-md border border-border bg-surface-2 px-3 py-2">
                            <div className="text-text-1 font-medium">{c.label}</div>
                            {typeof c.participants === "string" && (
                              <div className="text-text-3 text-xs mt-0.5">Beteiligte: {c.participants}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dna.vertical.decision_models?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Entscheidungs-Modelle</h4>
                      <ul className="space-y-2">
                        {dna.vertical.decision_models.slice(0, 6).map((d) => (
                          <li key={d.key} className="text-sm rounded-md border border-border bg-surface-2 px-3 py-2">
                            <div className="text-text-1 font-medium">{d.label}</div>
                            {typeof d.approver === "string" && (
                              <div className="text-text-3 text-xs mt-0.5">Freigabe: {d.approver}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dna.vertical.document_intelligence?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-text-2 mb-3 uppercase tracking-wide">Dokument-Intelligenz</h4>
                      <ul className="space-y-2">
                        {dna.vertical.document_intelligence.slice(0, 6).map((d) => (
                          <li key={d.key} className="text-sm rounded-md border border-border bg-surface-2 px-3 py-2">
                            <div className="text-text-1 font-medium">{d.label}</div>
                            {Array.isArray(d.required_fields) && d.required_fields.length > 0 && (
                              <div className="text-text-3 text-xs mt-0.5">
                                Pflichtfelder: {(d.required_fields as string[]).slice(0, 4).join(", ")}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-text-3 mt-8">
              Quelle: BerufOS Berufs-Graph (Branche {industryKey}). Read-only Bridge —
              kein generiertes Wissen, keine Halluzination.
            </p>
          </div>
        </section>
      )}

      {/* VerwaltungsOS — Fachbereichs-Intelligenz (nur Verwaltungs-Vertical) */}
      {vertical.slug === "verwaltung" && (
        <>
          <VerwaltungDepartmentsSection />
          <VerwaltungArbeitsmarktSection />
          <VerwaltungBundLagebildSection />
        </>
      )}

      {/* PRICING */}
      <section id="pricing" className="border-t border-border bg-surface-1">
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <h2 className="text-2xl md:text-3xl font-bold text-text-1 mb-2">Pakete für {vertical.brand}</h2>
          <p className="text-text-2 mb-8">Klar kalkulierbar. Keine "unlimited AI". Limits transparent in Vorgängen pro Monat.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {VERTICAL_TIERS.map((t) => (
              <Card key={t.key} className={t.recommended ? "border-primary shadow-elev-2" : ""}>
                <CardHeader>
                  {t.recommended && <Badge className="mb-2 w-fit">Empfohlen</Badge>}
                  <CardTitle className="text-text-1">{t.label}</CardTitle>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-3xl font-bold text-text-1">{t.priceDisplay}</span>
                    <span className="text-text-3 text-sm">/ Monat</span>
                  </div>
                  <CardDescription className="text-text-2">
                    {t.monthlyVorgangLimit.toLocaleString("de-DE")} Vorgänge / Monat
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-text-2 mb-5">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={t.recommended ? "default" : "outline"}
                    disabled={loadingTier === t.key}
                    onClick={() => handleSubscribe(t.key)}
                  >
                    {loadingTier === t.key ? "Wird vorbereitet …" : t.ctaLabel}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* EU TRUST */}
      <section className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="rounded-xl border border-border bg-surface-1 p-6">
          <div className="flex items-start gap-3">
            <Shield className="h-6 w-6 text-primary shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-bold text-text-1 mb-1">Souveräne europäische Branchenintelligenz</h3>
              <p className="text-sm text-text-2">
                EU-Hosting · EU-Datenhaltung · DSGVO by Default · AI-Act-ready by Design · Audit-Trail
                jeder Mutation · Human-in-the-Loop strukturell verankert (kein Auto-Apply).
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
