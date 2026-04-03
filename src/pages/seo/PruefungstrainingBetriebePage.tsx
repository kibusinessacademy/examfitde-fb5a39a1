import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL } from '@/lib/seo';
import {
  ArrowRight,
  BarChart3,
  TrendingDown,
  Clock,
  ShieldCheck,
  Users,
  CheckCircle,
  AlertTriangle,
  Target,
} from 'lucide-react';

export default function PruefungstrainingBetriebePage() {
  return (
    <>
      <SEOHead
        title="IHK Prüfungsvorbereitung für Betriebe – Bestehensquote steigern | ExamFit"
        description="IHK Prüfungstraining für Ausbildungsbetriebe: Bestehensquoten erhöhen, Durchfallrisiken erkennen, Ausbildungsqualität messbar machen. Prüfungstrainer mit KI für Ihre Azubis."
        canonical="/pruefungstraining-betriebe"
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              Bestehensquoten erhöhen.{' '}
              <span className="text-gradient text-glow">Ausbildungsqualität messbar machen.</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              ExamFit ist ein intelligentes Prüfungstrainings-System für Ausbildungsbetriebe,
              die ihre Auszubildenden sicher durch die Abschlussprüfung bringen wollen.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg">
                  Lizenzen für Auszubildende erwerben
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/unternehmen">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Mehr erfahren
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Kernargumente */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Warum Betriebe auf ExamFit <span className="text-gradient">setzen</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: BarChart3, title: 'Prüfungsreife messen', text: 'Transparenter Kompetenzstand je Auszubildendem – objektiv statt Bauchgefühl.' },
                { icon: TrendingDown, title: 'Durchfallquoten senken', text: 'Weniger Durchfaller, weniger Nacharbeit, weniger Kosten.' },
                { icon: AlertTriangle, title: 'Frühwarnsystem', text: 'Prüfungsrisiken frühzeitig erkennen und gezielt gegensteuern.' },
                { icon: ShieldCheck, title: 'Qualität standardisieren', text: 'Einheitliche Prüfungsvorbereitung für alle Auszubildenden.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center">
                  <Icon className="h-10 w-10 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Nutzen im Ausbildungsalltag */}
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              So integriert sich ExamFit in Ihren <span className="text-gradient">Ausbildungsalltag</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {[
                { icon: CheckCircle, text: 'Ergänzt die betriebliche Ausbildung – ohne zusätzlichen Schulungsaufwand' },
                { icon: Users, text: 'Auszubildende trainieren selbstständig – jederzeit und überall' },
                { icon: Target, text: 'Trainiert exakt das, was in der Prüfung verlangt wird' },
                { icon: BarChart3, text: 'Objektive Daten zu Kompetenzständen statt subjektiver Einschätzung' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-4 glass-card rounded-2xl p-6">
                  <Icon className="h-6 w-6 text-success flex-shrink-0 mt-0.5" />
                  <p className="text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Einsatzszenarien */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-12">
              Typische <span className="text-gradient">Einsatzszenarien</span>
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="glass-card rounded-2xl p-6">
                <div className="text-4xl mb-4">📝</div>
                <h3 className="font-semibold mb-2">Teil 1 & Teil 2</h3>
                <p className="text-sm text-muted-foreground">Gezielte Vorbereitung auf beide Teile der Abschlussprüfung.</p>
              </div>
              <div className="glass-card rounded-2xl p-6">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="font-semibold mb-2">Leistungsschwächere fördern</h3>
                <p className="text-sm text-muted-foreground">Auszubildende mit Prüfungsrisiko individuell unterstützen.</p>
              </div>
              <div className="glass-card rounded-2xl p-6">
                <div className="text-4xl mb-4">📊</div>
                <h3 className="font-semibold mb-2">Qualitätssicherung</h3>
                <p className="text-sm text-muted-foreground">Ausbildungsqualität messbar und vergleichbar machen.</p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-4xl">
            <div className="glass-strong rounded-3xl p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10">
                <Users className="h-16 w-16 text-primary mx-auto mb-6" />
                <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                  Prüfungstraining für Ihre Auszubildenden einrichten
                </h2>
                <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                  Mehrplatzlizenzen ab 5 Auszubildenden mit automatischem Mengenrabatt.
                </p>
                <div className="flex items-baseline gap-2 justify-center mb-8">
                  <span className="text-4xl font-display font-bold text-gradient">39 €</span>
                  <span className="text-muted-foreground">pro Lizenz · einmalig · 12 Monate</span>
                </div>
                <Link to="/shop">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8">
                    Lizenzen erwerben
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
