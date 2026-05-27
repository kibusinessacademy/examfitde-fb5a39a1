import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  Brain,
  Shield,
  Activity,
  Workflow,
  Users,
  Radar,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Lock,
  GitBranch,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CANONICAL = "https://berufos.com/berufagentos";
const TITLE =
  "BerufAgentOS — Continuous Intelligence OS für Unternehmens-Outcomes";
const DESCRIPTION =
  "BerufAgentOS ist das governance-fähige Branchenbetriebssystem, das Unternehmensprozesse kontinuierlich überwacht, bewertet und optimiert — mit Berufslogik, Persona-Simulation und Human-in-the-Loop.";

const PILLARS = [
  {
    icon: Target,
    title: "Business Intent Layer",
    desc: "Versteht Unternehmensziele, KPIs und Branchenkontext als erste Klasse.",
  },
  {
    icon: Brain,
    title: "Persistent Intelligence Memory",
    desc: "Lernt dauerhaft — kein Reset, kein Prompt-Theater, sondern Outcome-Gedächtnis.",
  },
  {
    icon: Activity,
    title: "Continuous Outcome Intelligence",
    desc: "Erkennt Drift, Risiken und Chancen kontinuierlich gegen reale KPIs.",
  },
  {
    icon: Workflow,
    title: "HITL Fix Queue",
    desc: "Kontrollierte Verbesserungsvorschläge mit Audit, Begründung, Rollback-Pfad.",
  },
  {
    icon: Users,
    title: "Persona Simulation",
    desc: "Testet jeden Vorschlag gegen Azubi, Ausbilder, HR, Schule/IHK, Ops.",
  },
  {
    icon: Radar,
    title: "Mission Control",
    desc: "Priorisiert Konflikte, Risiken und Entscheidungen vor menschlicher Freigabe.",
  },
];

const DIFF = [
  ["Generisch", "Branchen- & berufsspezifisch"],
  ["Promptbasiert", "Persistent & outcome-aware"],
  ["Ohne Gedächtnis", "Outcome Memory mit Audit"],
  ["Ohne Governance", "Governance & Approval-Chain"],
  ["Autonomes Chaos", "Controlled Autonomy mit HITL"],
  ["Chatbot-Antworten", "Continuous Organizational Intelligence"],
];

const TIERS = [
  {
    name: "Pilot",
    tagline: "90-Tage Outcome-Pilot für eine Vertikale.",
    price: "ab 14.900 €",
    note: "einmalig · 1 Branchen-Vertikale · 1 Geschäftsziel",
    features: [
      "Business Intent Workshop",
      "Intelligence Memory Seed",
      "1 HITL Fix Queue (Read-only)",
      "Persona Simulation für 3 Rollen",
      "Mission Control Read-only",
      "Wöchentlicher Outcome-Report",
    ],
    cta: "Pilot anfragen",
    href: "mailto:hello@berufos.com?subject=BerufAgentOS%20Pilot%20Anfrage",
    highlight: false,
  },
  {
    name: "Operate",
    tagline: "Continuous Intelligence für eine Organisation.",
    price: "ab 4.900 €/Monat",
    note: "12 Monate · bis 3 Vertikalen · alle 5 Personas",
    features: [
      "Alles aus Pilot",
      "Continuous Outcome Intelligence aktiv",
      "Mission Control Decision Queue",
      "Persona Conflict Matrix",
      "Audit-Ledger & DSGVO-Export",
      "Quartals-Review mit Outcome-Coach",
    ],
    cta: "Operate-Lizenz sichern",
    href: "mailto:hello@berufos.com?subject=BerufAgentOS%20Operate%20Lizenz",
    highlight: true,
  },
  {
    name: "Enterprise",
    tagline: "Branchen-OS mit Governance & SSO.",
    price: "auf Anfrage",
    note: "unbegrenzte Vertikalen · SSO · Custom Personas · DPA",
    features: [
      "Alles aus Operate",
      "SSO / SAML · SCIM",
      "Custom Persona Registry",
      "Policy Engine Vorbereitung (v3.3)",
      "Apply-Ledger Onboarding (v3.1)",
      "Dedizierter Outcome-Architect",
    ],
    cta: "Enterprise sprechen",
    href: "mailto:hello@berufos.com?subject=BerufAgentOS%20Enterprise",
    highlight: false,
  },
];

const FAQ = [
  {
    q: "Ist das ein Chatbot oder Agent-Builder?",
    a: "Nein. BerufAgentOS ist ein Outcome-Intelligence-System. Es beobachtet KPIs, erkennt Drift und schlägt kontrollierte Verbesserungen vor — keine generischen Prompt-Spiele.",
  },
  {
    q: "Wie wird Autonomie kontrolliert?",
    a: "Strikt nach dem Prinzip Detection → Proposal → Human Review. Es gibt keinen Auto-Apply, keine Workflow-Mutationen und kein Self-Healing in der aktuellen Generation.",
  },
  {
    q: "Was unterscheidet euch von generischer AI?",
    a: "Persistent Intelligence Memory, Berufs-/Branchen-DNA, Persona-Simulation und ein Governance-Layer mit Audit-Contracts. Das ist architekturell — nicht prompt-basiert.",
  },
  {
    q: "Wie sieht der Einstieg aus?",
    a: "Wir starten mit einem 90-Tage-Pilot in einer Vertikalen. Outcome-KPI, Intent-Layer und Mission Control werden gemeinsam definiert und nach 12 Wochen evaluiert.",
  },
  {
    q: "Ist DSGVO/AI-Act ready?",
    a: "Die Architektur ist auf europäische Regulierung ausgelegt — Audit-Ledger, Capability-Gates, Approval-Chains und Evidence-Tracking sind erste-Klasse-Konstrukte.",
  },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "BerufAgentOS",
  description: DESCRIPTION,
  brand: { "@type": "Brand", name: "BerufOS" },
  category: "AI Operations Platform",
  offers: [
    {
      "@type": "Offer",
      name: "Pilot",
      price: "14900",
      priceCurrency: "EUR",
      url: CANONICAL,
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Operate",
      price: "4900",
      priceCurrency: "EUR",
      url: CANONICAL,
      availability: "https://schema.org/InStock",
    },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function BerufAgentOSLandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={CANONICAL} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={CANONICAL} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json">{JSON.stringify(JSON_LD)}</script>
        <script type="application/ld+json">{JSON.stringify(FAQ_LD)}</script>
      </Helmet>

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28">
          <Badge variant="outline" className="mb-6 gap-1.5 font-medium">
            <Sparkles className="h-3 w-3" /> v2 · Continuous Outcome Intelligence
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] max-w-4xl">
            Das Continuous Intelligence OS
            <br />
            <span className="text-muted-foreground">
              für Unternehmens-Outcomes.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg md:text-xl text-muted-foreground leading-relaxed">
            BerufAgentOS überwacht, bewertet und optimiert
            Geschäftsprozesse kontinuierlich — mit Berufslogik, Persona-Simulation
            und menschlicher Freigabe. Kein Chatbot. Kein Auto-Apply. Sondern
            kontrollierte, auditierbare Organisations-Intelligenz.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <a href="#pricing">
                Pilot starten <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base">
              <a href="#manifest">Manifest lesen</a>
            </Button>
          </div>

          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl">
            {[
              ["6", "Architektur-Layer"],
              ["5", "Persona-Rollen"],
              ["100%", "HITL-kontrolliert"],
              ["0", "Auto-Apply"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="text-2xl md:text-3xl font-semibold tracking-tight">
                  {v}
                </div>
                <div className="text-xs md:text-sm text-muted-foreground mt-1">
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl mb-12">
          <Badge variant="secondary" className="mb-4">
            Architektur
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Sechs Layer. Ein kontrolliertes Betriebssystem.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Jeder Layer ist auditierbar, governance-fähig und Teil der gleichen
            Outcome-Kette.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PILLARS.map((p, i) => (
            <Card key={p.title} className="p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <p.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  Cut 2.{i + 1}
                </div>
              </div>
              <h3 className="font-semibold text-lg mb-1.5">{p.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {p.desc}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* DIFFERENTIATION */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="max-w-2xl mb-10">
            <Badge variant="secondary" className="mb-4">
              Kategorie
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Andere AI-Tools.
              <br />
              BerufAgentOS.
            </h2>
          </div>

          <div className="grid gap-px bg-border rounded-xl overflow-hidden border border-border">
            {DIFF.map(([a, b]) => (
              <div
                key={a}
                className="grid grid-cols-2 gap-px bg-border"
              >
                <div className="bg-background px-6 py-4 text-muted-foreground line-through decoration-1">
                  {a}
                </div>
                <div className="bg-background px-6 py-4 font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  {b}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MANIFEST / Blogpost inline */}
      <section id="manifest" className="mx-auto max-w-3xl px-6 py-20">
        <Badge variant="secondary" className="mb-4">
          Manifest
        </Badge>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
          Intelligenz zuerst. Autonomie später.
        </h2>
        <article className="prose prose-neutral dark:prose-invert max-w-none text-foreground">
          <p className="text-lg text-muted-foreground leading-relaxed">
            Die meisten AI-Produkte versprechen Autonomie und liefern Chaos.
            Sie bauen Agenten, bevor sie Outcomes verstehen. Sie mutieren
            Workflows, bevor sie KPIs messen. Sie operieren ohne Gedächtnis,
            ohne Branchenlogik, ohne Governance.
          </p>
          <h3 className="mt-10">Wir haben den umgekehrten Weg gewählt.</h3>
          <p>
            BerufAgentOS beginnt nicht mit dem Agenten — sondern mit dem
            Outcome. Was ist das Geschäftsziel? Welche KPIs zählen? Welche
            Branche, welcher Beruf, welche Persona ist betroffen? Erst wenn
            das System diese Fragen kontinuierlich beantworten kann, darf es
            Vorschläge machen. Und selbst dann: nie ohne menschliche Freigabe.
          </p>
          <h3>Die sechs Cuts.</h3>
          <p>
            <strong>2.1 Business Intent Layer</strong> verankert Ziele.
            <strong> 2.2 Persistent Intelligence Memory</strong> verhindert
            Reset-Amnesie. <strong>2.3 Continuous Outcome Intelligence</strong>{" "}
            erkennt Drift in Echtzeit. <strong>2.4 HITL Fix Queue</strong>{" "}
            erzeugt nur Proposals — niemals Mutationen.{" "}
            <strong>2.5 Persona Simulation</strong> testet jeden Vorschlag
            gegen reale Rollen. <strong>2.6 Mission Control</strong> löst
            Konflikte auf und empfiehlt — entscheidet aber nie selbst.
          </p>
          <h3>Was jetzt nicht passieren darf.</h3>
          <p>
            Kein Auto-Apply. Kein Self-Healing in der Runtime. Keine
            unkontrollierten Mutationen. Kein „Agent entscheidet alles selbst".
            Das wäre der typische Fehler — und der teuerste.
          </p>
          <h3>Der Moat.</h3>
          <p>
            Nicht das Modell. Sondern: Berufs-DNA, Branchen-DNA, Persistent
            Intelligence, Outcome Memory, Governance Layer, Continuous
            Intelligence, Persona Simulation, HITL-Control. Acht Schichten
            Disziplin. Extrem schwer kopierbar.
          </p>
          <p className="text-lg font-medium border-l-2 border-primary pl-4 italic">
            BerufAgentOS verbessert Unternehmensprozesse kontinuierlich — mit
            Berufslogik, Governance, Outcome-Kontrolle und menschlicher
            Freigabe.
          </p>
        </article>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-border/40 bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl mb-12">
            <Badge variant="secondary" className="mb-4">
              Lizenzen
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Drei Wege in eine kontrollierte AI-Operation.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Alle Lizenzen sind HITL-only. Auto-Apply ist nicht Teil von v2 —
              und wird auch in v3 erst nach Apply-Ledger und Policy-Engine
              freigeschaltet.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TIERS.map((t) => (
              <Card
                key={t.name}
                className={`p-6 flex flex-col ${
                  t.highlight
                    ? "border-primary shadow-lg ring-1 ring-primary/20"
                    : ""
                }`}
              >
                {t.highlight && (
                  <Badge className="self-start mb-3">Empfohlen</Badge>
                )}
                <h3 className="text-xl font-bold">{t.name}</h3>
                <p className="text-sm text-muted-foreground mt-1 min-h-[2.5rem]">
                  {t.tagline}
                </p>
                <div className="mt-5 mb-1">
                  <span className="text-3xl font-bold">{t.price}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-6">{t.note}</p>
                <ul className="space-y-2.5 text-sm mb-8 flex-1">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className="w-full"
                  variant={t.highlight ? "default" : "outline"}
                >
                  <a href={t.href}>{t.cta}</a>
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* GOVERNANCE STRIP */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Shield, t: "Governance-first", d: "Audit-Contracts, Capability-Gates, Evidence-Chains." },
            { icon: Lock, t: "DSGVO & AI-Act ready", d: "Architektur auf europäische Regulierung ausgelegt." },
            { icon: GitBranch, t: "Rollback-fähig", d: "Jede Entscheidung ist nachvollziehbar und reversibel." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex gap-4">
              <Icon className="h-5 w-5 text-primary mt-1 shrink-0" />
              <div>
                <h4 className="font-semibold">{t}</h4>
                <p className="text-sm text-muted-foreground mt-1">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <Badge variant="secondary" className="mb-4">
            FAQ
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-10">
            Häufige Fragen.
          </h2>
          <dl className="space-y-6">
            {FAQ.map((f) => (
              <div key={f.q} className="border-b border-border/60 pb-6">
                <dt className="font-semibold text-lg">{f.q}</dt>
                <dd className="mt-2 text-muted-foreground leading-relaxed">
                  {f.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="border-t border-border/40 bg-foreground text-background">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
            Hilf deiner Organisation,
            <br />
            dauerhaft intelligenter zu werden.
          </h2>
          <p className="mt-6 text-lg opacity-80 max-w-2xl mx-auto">
            Starte mit einem 90-Tage-Outcome-Pilot. Eine Vertikale. Ein
            Geschäftsziel. Volle Kontrolle.
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Button asChild size="lg" variant="secondary" className="h-12 px-6 text-base">
              <a href="mailto:hello@berufos.com?subject=BerufAgentOS%20Pilot%20Anfrage">
                Pilot anfragen <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 px-6 text-base bg-transparent border-background/30 text-background hover:bg-background hover:text-foreground"
            >
              <Link to="/app/beruf-agent-os">Mission Control ansehen</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
