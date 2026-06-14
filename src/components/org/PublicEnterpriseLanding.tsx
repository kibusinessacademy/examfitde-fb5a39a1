import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Building2, Play, LogIn, Mail, Shield, Users, BarChart3, ArrowRight,
  CheckCircle2, Zap, Globe2, Lock, FileCheck2, GraduationCap,
} from 'lucide-react';

/**
 * KIMI.3.6 — Public-aware Enterprise Console entry.
 * Cold visitors and crawlers MUST get a fully rendered B2B landing — no auth /
 * org-context loaders may block the hero. Targets ≥ 3 KB text, ≥ 2 CTAs,
 * hydration_state=ready, valid <h1>, visible benefits + FAQ.
 */
export default function PublicEnterpriseLanding({
  reason = 'unauthenticated',
}: { reason?: 'unauthenticated' | 'no_org' }) {
  const isNoOrg = reason === 'no_org';

  return (
    <>
      <Helmet>
        <title>Enterprise Console · BerufOS für Ausbildungs-Teams</title>
        <meta
          name="description"
          content="Lizenzen, Seats, Einladungen und Prüfungsreife-Reporting für Azubi-Teams ab 5 Personen. SSO, SCIM, EU-Hosting, DSGVO. Demo in 5 Minuten."
        />
        <link rel="canonical" href="https://berufos.com/org/enterprise" />
      </Helmet>

      <main className="min-h-screen bg-background">
        {/* ─── Hero ─────────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="max-w-5xl mx-auto px-4 py-16 sm:py-24">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <Building2 className="h-4 w-4 text-primary" />
              <span>Enterprise Console · BerufOS für Ausbildungs-Teams</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground max-w-3xl leading-tight">
              {isNoOrg
                ? 'Du bist noch keiner Organisation zugeordnet'
                : 'Die Enterprise-Konsole für Ausbildungs-Teams'}
            </h1>

            <p className="mt-5 text-lg text-muted-foreground max-w-2xl">
              {isNoOrg
                ? 'Sobald deine Firma einen Enterprise-Tarif aktiviert oder dich als Admin einlädt, erscheint hier dein Team-Cockpit mit Lizenzen, Seats, Einladungen und Prüfungsreife-Reporting. Bis dahin findest du unten die schnellsten Wege zum Vertriebs- und Demo-Kontakt.'
                : 'BerufOS Enterprise gibt IT, HR und Ausbildungsleitung eine einzige Konsole für alle Azubis: Lizenzen vergeben, Seats verwalten, Einladungen versenden und in Echtzeit sehen, welche Mitarbeitenden die nächste Prüfung wirklich bestehen werden. Ab 5 Azubi-Lizenzen.'}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-8">
              <Button size="lg" className="gap-2 text-base rounded-xl px-8" asChild>
                <Link to="/enterprise-demo">
                  <Play className="h-5 w-5" /> 5-Minuten-Demo buchen
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-base rounded-xl px-8" asChild>
                <Link to="/auth?return=%2Forg%2Fenterprise">
                  <LogIn className="h-5 w-5" /> Als Admin anmelden
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-base rounded-xl px-8" asChild>
                <a href="mailto:enterprise@berufos.com?subject=Enterprise%20Anfrage%20%E2%80%93%20BerufOS">
                  <Mail className="h-5 w-5" /> Vertrieb kontaktieren
                </a>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Ab 5 Lizenzen</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> SSO &amp; SCIM</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> EU-Hosting Frankfurt</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> DSGVO &amp; AV-Vertrag</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Onboarding in 48 h</li>
            </ul>
          </div>
        </section>

        {/* ─── Benefits ────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            Was die Konsole für Ausbildungs-Teams leistet
          </h2>
          <p className="text-muted-foreground max-w-2xl mb-8">
            Eine Oberfläche für die komplette Azubi-Reise — vom Onboarding bis zur Prüfungsreife.
            Keine Excel-Listen, keine doppelte Lizenz-Pflege, keine Black-Box.
          </p>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                icon: Users,
                title: 'Seats &amp; Einladungen',
                desc: 'Lizenzen zentral verteilen, Einladungen per E-Mail oder Bulk-Upload versenden, Rollen (Owner, Admin, Manager, Learner) vergeben — alles in einer Oberfläche, mit Audit-Log.',
              },
              {
                icon: BarChart3,
                title: 'Prüfungsreife in Echtzeit',
                desc: 'Sehe für jedes Team-Mitglied den Status: aktive Lernzeit, Mini-Check-Score, Risiko-Cluster und nächste empfohlene Schritte — bevor die Prüfungswoche beginnt.',
              },
              {
                icon: Shield,
                title: 'SSO, SCIM, EU-Hosting',
                desc: 'Azure AD, Okta, Google Workspace via SAML. SCIM-Provisioning. Daten in Frankfurt, DSGVO-konform, mit Auftragsverarbeitungs-Vertrag und Pen-Test-Bericht auf Anfrage.',
              },
              {
                icon: Zap,
                title: 'Automatische Provisionierung',
                desc: 'Nach Stripe-Checkout werden Lizenzen, Seats und Owner-Account innerhalb von Sekunden angelegt. Kein manuelles Setup, kein Ticket beim Support.',
              },
              {
                icon: FileCheck2,
                title: 'Compliance-Ready Reports',
                desc: 'Exportierbare PDF- und CSV-Reports für IHK, HWK und interne Audit-Anforderungen. Lernzeit-Nachweis pro Azubi, Prüfungsreife-Trend pro Klasse.',
              },
              {
                icon: GraduationCap,
                title: 'Mehr-Standort &amp; Konzernstruktur',
                desc: 'Parent-Org / Child-Org-Modell für Konzerne mit mehreren Standorten, Tochterfirmen oder Schul-Verbünden. Rollenrechte vererben sich automatisch.',
              },
            ].map(b => (
              <Card key={b.title} className="rounded-xl">
                <CardContent className="p-5">
                  <b.icon className="h-6 w-6 text-primary mb-3" />
                  <h3 className="font-semibold text-foreground" dangerouslySetInnerHTML={{ __html: b.title }} />
                  <p className="text-sm text-muted-foreground mt-1" dangerouslySetInnerHTML={{ __html: b.desc }} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ─── KPIs ─────────────────────────────────────────────── */}
        <section className="border-y border-border bg-surface-sunken/40">
          <div className="max-w-5xl mx-auto px-4 py-12 grid sm:grid-cols-4 gap-6 text-center">
            {[
              { kpi: '48 h', label: 'Bis zur Konsole — vom Vertragsabschluss bis zum ersten Admin-Login.' },
              { kpi: '5 Min', label: 'Demo-Länge — strukturiert, ohne Vertriebs-Pitch, mit Live-Daten.' },
              { kpi: '≥ 85 %', label: 'Trust-Score in unserer eigenen Reality-QA pro Release.' },
              { kpi: '100 %', label: 'EU-Hosting in Frankfurt, keine Sub-Prozessoren außerhalb der EU.' },
            ].map(k => (
              <div key={k.kpi}>
                <div className="text-3xl font-extrabold text-foreground">{k.kpi}</div>
                <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── How it works ────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-8">
            So kommst du in 3 Schritten zur produktiven Konsole
          </h2>
          <ol className="grid sm:grid-cols-3 gap-4">
            {[
              { n: 1, t: 'Demo &amp; Vertragsangebot', d: '5-Minuten-Demo mit dem Vertriebs-Team. Wir senden dir ein Angebot inkl. AV-Vertrag, SSO-Spezifikation und SCIM-Anbindung — meistens innerhalb von 24 Stunden.' },
              { n: 2, t: 'Onboarding-Call &amp; Setup', d: 'Ein 30-Minuten-Call mit unserem Onboarding-Team. Wir richten deine Org an, importieren Mitarbeiter-Listen und konfigurieren SSO. Du erhältst Owner-Zugang.' },
              { n: 3, t: 'Lizenzen verteilen', d: 'Du verteilst Lizenzen per Bulk-Import oder Einzeleinladung. Deine Azubis erhalten eine Mail mit dem persönlichen Aktivierungslink — keine Passwort-Reset-Schleifen.' },
            ].map(s => (
              <li key={s.n} className="rounded-xl border border-border bg-card p-5">
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center mb-3">{s.n}</div>
                <h3 className="font-semibold text-foreground" dangerouslySetInnerHTML={{ __html: s.t }} />
                <p className="text-sm text-muted-foreground mt-1" dangerouslySetInnerHTML={{ __html: s.d }} />
              </li>
            ))}
          </ol>
        </section>

        {/* ─── Trust ───────────────────────────────────────────── */}
        <section className="border-t border-border">
          <div className="max-w-5xl mx-auto px-4 py-12 grid sm:grid-cols-3 gap-6">
            {[
              { icon: Lock, t: 'Security &amp; Datenschutz', d: 'TLS 1.3, AES-256 at rest, granulare RLS-Policies pro Org, Audit-Log unveränderlich, jährlicher externer Pen-Test.' },
              { icon: Globe2, t: 'Made &amp; hosted in EU', d: 'Server in Frankfurt am Main, Backups in Berlin. Keine Daten verlassen den EU-Raum. Sub-Prozessoren öffentlich gelistet.' },
              { icon: FileCheck2, t: 'Auditierbar', d: 'Jede Owner-, Admin- oder Manager-Aktion landet im Audit-Trail. Export für Compliance-Teams, IHK-Prüfer oder interne Revision.' },
            ].map(t => (
              <div key={t.t} className="flex gap-3">
                <t.icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <h3 className="font-semibold text-foreground text-sm" dangerouslySetInnerHTML={{ __html: t.t }} />
                  <p className="text-sm text-muted-foreground mt-1" dangerouslySetInnerHTML={{ __html: t.d }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Final CTA ───────────────────────────────────────── */}
        <section className="border-t border-border">
          <div className="max-w-3xl mx-auto px-4 py-16 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              Bereit, deine Azubis zur Prüfungsreife zu bringen?
            </h2>
            <p className="mt-3 text-muted-foreground">
              In 5 Minuten zeigen wir dir die Konsole live, beantworten alle Fragen zu SSO,
              SCIM und Datenschutz und senden dir ein konkretes Angebot.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" className="gap-2 rounded-xl px-8" asChild>
                <Link to="/enterprise-demo">
                  <Play className="h-5 w-5" /> Demo buchen
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 rounded-xl px-8" asChild>
                <Link to="/preise">
                  Preise &amp; Pakete <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Schon eingeladen worden? Öffne den Einladungslink aus deiner E-Mail —
              er bringt dich direkt in die richtige Organisation.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
