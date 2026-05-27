import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { VERTICALS } from "@/data/verticals";
import { VERTICAL_TIERS } from "@/config/verticalPricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, ArrowRight } from "lucide-react";

export default function VerticalsHubPage() {
  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Branchenbetriebssysteme — Digitale Entlastung für Praxen, Kanzleien, Betriebe</title>
        <meta
          name="description"
          content="Digitale Branchenassistenten für den deutschen Mittelstand: PraxisOS, SteuerOS, HandwerkOS, VerwaltungsOS u.v.m. Dokumentation, Kommunikation und Tagesorganisation — EU-gehostet, DSGVO- und AI-Act-konform."
        />
        <link rel="canonical" href="https://berufos.com/branchen" />
      </Helmet>

      {/* HERO */}
      <section className="border-b border-border bg-surface-1">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-6xl">
          <Badge variant="outline" className="mb-4">EU-souverän · DSGVO · AI-Act-ready</Badge>
          <h1 className="text-4xl md:text-6xl font-bold text-text-1 mb-6 leading-tight">
            Der digitale Branchenmitarbeiter.<br />
            <span className="text-text-2">Für Praxen, Kanzleien, Betriebe, Behörden.</span>
          </h1>
          <p className="text-lg md:text-xl text-text-2 max-w-3xl mb-8">
            BerufOS verwandelt repetitive Arbeit in deiner Branche in spürbare Entlastung — mit
            klaren Vorgangs-Limits, voller Auditierbarkeit und Human-in-the-Loop dort, wo es zählt.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-text-2">
            <span className="inline-flex items-center gap-2"><Shield className="h-4 w-4" />EU-Hosting</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Keine "unlimited AI" — klare Kalkulation</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Auto-Apply ausgeschlossen</span>
          </div>
        </div>
      </section>

      {/* VERTICALS GRID */}
      <section className="container mx-auto px-4 py-16 max-w-6xl">
        <h2 className="text-2xl md:text-3xl font-bold text-text-1 mb-2">11 Branchenbetriebssysteme</h2>
        <p className="text-text-2 mb-10">
          Jede Branche hat ihre eigene DNA. Wähle dein Vertical — das Pricing ist überall gleich.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {VERTICALS.map((v) => (
            <Link to={`/branchen/${v.slug}`} key={v.slug} className="group">
              <Card className="h-full hover:shadow-elev-2 transition-shadow border-border-strong/40">
                <CardHeader>
                  <div className="text-3xl mb-2">{v.emoji}</div>
                  <CardTitle className="text-text-1 group-hover:text-text-1">{v.brand}</CardTitle>
                  <CardDescription className="text-text-2">{v.tagline}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-text-3 mb-3">{v.audience}</p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-text-1">
                    Branche ansehen <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* PRICING OVERVIEW */}
      <section className="border-t border-border bg-surface-1">
        <div className="container mx-auto px-4 py-16 max-w-6xl">
          <h2 className="text-2xl md:text-3xl font-bold text-text-1 mb-2">Klar kalkulierbare Branchenpakete</h2>
          <p className="text-text-2 mb-10">
            Keine versteckten AI-Kosten. Limits werden in "intelligenten Vorgängen pro Monat" gemessen — nicht in Tokens.
          </p>
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
                  <ul className="space-y-2 text-sm text-text-2">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-text-3 mt-6">
            Preise zzgl. MwSt. Selfservice-Checkout für Starter und Professional. Enterprise via Sales-Kontakt.
          </p>
        </div>
      </section>

      {/* EU TRUST FOOTER */}
      <section className="container mx-auto px-4 py-16 max-w-4xl text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-text-1 mb-4">
          Souveräne europäische Branchenintelligenz.
        </h2>
        <p className="text-text-2 mb-6">
          EU-Hosting · EU-Datenhaltung · DSGVO by Default · AI-Act-ready by Design · Audit-Trail jeder Mutation.
        </p>
      </section>
    </main>
  );
}
