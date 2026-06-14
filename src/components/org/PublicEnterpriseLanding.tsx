import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Play, LogIn, Mail, Shield, Users, BarChart3, ArrowRight } from 'lucide-react';

/**
 * KIMI.3.4 — Public-aware Enterprise Console entry.
 * Cold visitors on /org/enterprise no longer get bounced to /auth (auth_lost=true =
 * funnel blocker). Instead they see a real B2B landing with three concrete CTAs:
 * Demo buchen, Anmelden, Vertrieb kontaktieren.
 */
export default function PublicEnterpriseLanding({
  reason = 'unauthenticated',
}: { reason?: 'unauthenticated' | 'no_org' }) {
  const isNoOrg = reason === 'no_org';
  return (
    <>
      <Helmet>
        <title>Enterprise Console · BerufOS für Teams</title>
        <meta name="description" content="Lizenzen, Seats, Invites und Reporting für Ausbildungs-Teams ab 5 Azubis. Demo in 5 Minuten, SSO/SCIM, EU-Hosting." />
        <link rel="canonical" href="https://berufos.com/org/enterprise" />
      </Helmet>
      <main className="min-h-screen bg-background">
        <section className="border-b">
          <div className="max-w-5xl mx-auto px-4 py-16 sm:py-24">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <Building2 className="h-4 w-4 text-primary" />
              <span>Enterprise Console · BerufOS für Teams</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground max-w-3xl leading-tight">
              {isNoOrg
                ? 'Du bist noch keiner Organisation zugeordnet'
                : 'Die Konsole für Ausbildungs-Teams'}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
              {isNoOrg
                ? 'Sobald deine Firma einen Enterprise-Tarif aktiviert oder dich einlädt, erscheint hier dein Team-Cockpit. Bis dahin findest du den schnellsten Weg unten.'
                : 'Lizenzen, Seats, Einladungen und Prüfungsreife-Reporting für Azubi-Teams ab 5 Personen. SSO, SCIM, EU-Hosting.'}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-8">
              <Button size="lg" className="gap-2 text-base rounded-xl px-8" asChild>
                <Link to="/enterprise-demo">
                  <Play className="h-5 w-5" /> 5-Minuten Demo buchen
                </Link>
              </Button>
              {!isNoOrg && (
                <Button size="lg" variant="outline" className="gap-2 text-base rounded-xl px-8" asChild>
                  <Link to="/auth?return=%2Forg%2Fenterprise">
                    <LogIn className="h-5 w-5" /> Als Admin anmelden
                  </Link>
                </Button>
              )}
              <Button size="lg" variant="outline" className="gap-2 text-base rounded-xl px-8" asChild>
                <a href="mailto:enterprise@berufos.com?subject=Enterprise%20Anfrage%20%E2%80%93%20BerufOS">
                  <Mail className="h-5 w-5" /> Vertrieb kontaktieren
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 py-16 grid sm:grid-cols-3 gap-4">
          {[
            { icon: Users, title: 'Seats & Invites', desc: 'Lizenzen verteilen, Einladungen versenden, Rollen vergeben — alles in einer Oberfläche.' },
            { icon: BarChart3, title: 'Prüfungsreife in Echtzeit', desc: 'Sehen Sie für jedes Team-Mitglied den aktuellen Stand, Risiko und nächste Schritte.' },
            { icon: Shield, title: 'SSO, SCIM, EU-Hosting', desc: 'Azure AD / Okta / Google Workspace. Daten in Frankfurt. DSGVO-konform.' },
          ].map(b => (
            <Card key={b.title} className="rounded-xl">
              <CardContent className="p-5">
                <b.icon className="h-6 w-6 text-primary mb-3" />
                <h3 className="font-semibold text-foreground">{b.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{b.desc}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="border-t">
          <div className="max-w-3xl mx-auto px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">Schon eingeladen worden?</p>
            <Button variant="link" asChild>
              <Link to="/preise" className="gap-1">
                Preise & Pakete ansehen <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}
