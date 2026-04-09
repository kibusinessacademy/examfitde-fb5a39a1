import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Shield, CheckCircle2, TrendingUp, Users, Zap, BarChart3,
  ArrowRight, Globe, Lock, Award, Target, AlertTriangle,
  Play, Building2, GraduationCap, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

const STATS = [
  { value: '98%', label: 'Bestehensquote', icon: Award },
  { value: '5.000+', label: 'Azubis nutzen ExamFit', icon: Users },
  { value: '<30 Min', label: 'SSO/SCIM Setup', icon: Zap },
  { value: '100%', label: 'DSGVO-konform', icon: Lock },
];

const VALUE_PROPS = [
  {
    icon: BarChart3,
    title: 'Prüfungsreife in Echtzeit messen',
    desc: 'Sehen Sie für jeden Azubi sofort, wie prüfungsbereit er ist — nicht erst nach der Prüfung.',
  },
  {
    icon: AlertTriangle,
    title: 'Durchfallrisiko frühzeitig erkennen',
    desc: 'Unser System erkennt Risiko-Azubis automatisch und priorisiert nach Dringlichkeit.',
  },
  {
    icon: Target,
    title: 'Automatische Handlungsempfehlungen',
    desc: 'Konkrete Interventionen für kritische Fälle — direkt aus dem Dashboard umsetzbar.',
  },
  {
    icon: TrendingUp,
    title: 'Bestehensquote nachweislich steigern',
    desc: 'Datengestützte Vorbereitung statt Bauchgefühl. Messbare Ergebnisse für Ihr Reporting.',
  },
];

const IT_FEATURES = [
  { label: 'SSO', desc: 'Azure AD, Okta, Google Workspace — in Minuten live', icon: Shield },
  { label: 'SCIM 2.0', desc: 'Automatische User-Provisionierung aus Ihrem IdP', icon: Users },
  { label: 'EU-Hosting', desc: 'Alle Daten in Frankfurt (EU). DSGVO + AI Act konform.', icon: Globe },
  { label: 'API-first', desc: 'REST-APIs mit Scope-basierter Zugriffskontrolle', icon: Lock },
];

const DEMO_DATA = [
  { name: 'Max M.', readiness: 32, risk: 'high', color: 'text-destructive' },
  { name: 'Anna M.', readiness: 55, risk: 'medium', color: 'text-warning' },
  { name: 'Tim B.', readiness: 78, risk: 'low', color: 'text-success' },
  { name: 'Lisa S.', readiness: 12, risk: 'critical', color: 'text-destructive' },
  { name: 'Jonas W.', readiness: 91, risk: 'none', color: 'text-success' },
];

export default function EnterpriseDemoPage() {
  const demoBookingUrl = '#demo-booking';

  return (
    <>
      <Helmet>
        <title>Prüfungsreife Ihrer Azubis messen — ExamFit Enterprise Demo</title>
        <meta name="description" content="Sehen Sie vor der Prüfung, welche Azubis durchfallen. Dashboard für Prüfungsreife, Risiko-Erkennung und automatische Handlungsempfehlungen. SSO, SCIM, DSGVO-konform." />
        <meta property="og:title" content="ExamFit Enterprise — Prüfungsreife Ihrer Azubis in Echtzeit" />
        <meta property="og:description" content="Das Ausbildungssteuerungssystem für IT-Leiter und HR. SSO, SCIM, DSGVO-konform. Demo in 5 Minuten." />
        <link rel="canonical" href="https://examfitde.lovable.app/enterprise-demo" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "ExamFit Enterprise",
          "applicationCategory": "EducationalApplication",
          "operatingSystem": "Web",
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "EUR", "description": "Kostenlose Enterprise Demo" },
        })}</script>
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Hero */}
        <section className="relative overflow-hidden border-b">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3" />
          <div className="relative max-w-6xl mx-auto px-4 py-16 sm:py-24 text-center">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">Für IT-Leiter & Ausbildungsverantwortliche</Badge>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground max-w-3xl mx-auto leading-tight">
              Sehen Sie <span className="text-primary">vor der Prüfung</span>, welche Azubis durchfallen
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Messbare Prüfungsreife, automatische Risiko-Erkennung und konkrete Handlungsempfehlungen — in einem Enterprise-fähigen Dashboard.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
              <Button size="lg" className="gap-2 text-base rounded-xl px-8" asChild>
                <a href={demoBookingUrl}><Play className="h-5 w-5" /> 5-Minuten Demo buchen</a>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-base rounded-xl px-8" asChild>
                <a href="#features"><BarChart3 className="h-5 w-5" /> Features entdecken</a>
              </Button>
            </div>

            {/* Stats Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-12 max-w-3xl mx-auto">
              {STATS.map(s => (
                <div key={s.label} className="text-center">
                  <s.icon className="h-5 w-5 text-primary mx-auto mb-1" />
                  <div className="text-2xl font-bold text-foreground">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Dashboard Visual / Pain */}
        <section className="py-16 border-b" id="features">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold">Ihr Ausbildungs-Dashboard</h2>
              <p className="text-muted-foreground mt-2">So sieht Prüfungssteuerung in Echtzeit aus</p>
            </div>

            {/* Simulated Dashboard */}
            <Card className="max-w-3xl mx-auto border-2 border-primary/20 shadow-xl">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Siemens Ausbildungszentrum</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">Live-Daten</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-lg bg-destructive/10 p-3 text-center">
                    <div className="text-2xl font-bold text-destructive">2</div>
                    <div className="text-[10px] text-muted-foreground">Kritisch</div>
                  </div>
                  <div className="rounded-lg bg-warning/10 p-3 text-center">
                    <div className="text-2xl font-bold text-warning">1</div>
                    <div className="text-[10px] text-muted-foreground">Gefährdet</div>
                  </div>
                  <div className="rounded-lg bg-success/10 p-3 text-center">
                    <div className="text-2xl font-bold text-success">2</div>
                    <div className="text-[10px] text-muted-foreground">Bereit</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {DEMO_DATA.map(d => (
                    <div key={d.name} className="flex items-center gap-3 rounded-lg border p-2.5">
                      <GraduationCap className={cn("h-4 w-4", d.color)} />
                      <span className="text-sm font-medium flex-1">{d.name}</span>
                      <div className="w-24 bg-muted rounded-full h-2 overflow-hidden">
                        <div className={cn("h-full rounded-full", d.readiness >= 70 ? "bg-success" : d.readiness >= 40 ? "bg-warning" : "bg-destructive")} style={{ width: `${d.readiness}%` }} />
                      </div>
                      <span className="text-sm font-mono font-bold w-10 text-right">{d.readiness}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Value Props */}
        <section className="py-16 bg-muted/30 border-b">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold">Warum ExamFit Enterprise?</h2>
              <p className="text-muted-foreground mt-2">Der Unterschied zwischen reagieren und steuern</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {VALUE_PROPS.map(vp => (
                <Card key={vp.title} className="rounded-xl">
                  <CardContent className="p-5 flex gap-4">
                    <div className="shrink-0 rounded-xl bg-primary/10 p-3 h-fit">
                      <vp.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{vp.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{vp.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* IT Section */}
        <section className="py-16 border-b">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center mb-10">
              <Badge className="mb-3 bg-success/10 text-success border-success/30">Enterprise-Ready</Badge>
              <h2 className="text-2xl sm:text-3xl font-bold">Gebaut für IT-Abteilungen</h2>
              <p className="text-muted-foreground mt-2">SSO, SCIM, EU-Hosting — alles, was Ihr IT-Leiter braucht</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
              {IT_FEATURES.map(f => (
                <div key={f.label} className="flex items-start gap-3 rounded-xl border p-4">
                  <div className="rounded-lg bg-primary/10 p-2"><f.icon className="h-5 w-5 text-primary" /></div>
                  <div>
                    <div className="font-semibold text-sm">{f.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{f.desc}</div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-success ml-auto shrink-0 mt-1" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20" id="demo-booking">
          <div className="max-w-2xl mx-auto px-4 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold">Bereit für einen Pilot?</h2>
            <p className="text-muted-foreground mt-3">
              Die meisten Kunden starten mit einem Pilot für einen Ausbildungsjahrgang. In 5 Minuten zeigen wir Ihnen, wie das bei Ihnen aussehen könnte.
            </p>
            <Button size="lg" className="mt-6 gap-2 text-base rounded-xl px-10">
              <Play className="h-5 w-5" /> Jetzt Demo buchen
            </Button>
            <p className="text-xs text-muted-foreground mt-3">Kostenlos · 15 Minuten · Unverbindlich</p>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t py-8">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} ExamFit · Alle Daten in der EU (Frankfurt)</span>
            <div className="flex gap-4">
              <Link to="/datenschutz" className="hover:text-foreground">Datenschutz</Link>
              <Link to="/impressum" className="hover:text-foreground">Impressum</Link>
              <Link to="/agb" className="hover:text-foreground">AGB</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
