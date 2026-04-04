import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import {
  Target,
  CheckCircle,
  ArrowRight,
  Brain,
  Mic,
  TrendingUp,
  Shield,
  Clock,
  Zap,
  Star,
} from 'lucide-react';

export default function PruefungstrainingAzubisPage() {
  return (
    <>
      <SEOHead
        title={seoTitle("IHK Abschlussprüfung bestehen: Prüfungstraining für Azubis")}
        description="IHK Prüfung online üben: Prüfungssimulation mit echten Prüfungsaufgaben, KI-Prüfungscoach & Schwächenanalyse für Auszubildende. Abschlussprüfung Ausbildung Vorbereitung – jetzt starten!"
        canonical={`${SITE_URL}/pruefungstraining-azubis`}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Star className="h-4 w-4 text-warning fill-warning" />
              <span className="text-sm text-muted-foreground">98 % Bestehensquote bei unseren Nutzern</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-6 animate-fade-in">
              IHK Abschlussprüfung lernen:{' '}
              <span className="text-gradient text-glow">Prüfungstraining für Azubis</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              IHK Prüfung online üben – mit prüfungsnahen Aufgaben, realistischer Prüfungssimulation 
              und deinem persönlichen KI-Prüfungscoach. Typische Fehler vermeiden, sicher bestehen.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg">
                  Prüfung starten
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/exam-simulation">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Prüfung simulieren
                </Button>
              </Link>
            </div>

            <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span>Einmalzahlung, kein Abo</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span>12 Monate Zugang</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span>Basierend auf dem Ausbildungsrahmenplan</span>
              </div>
            </div>
          </div>
        </section>

        {/* Kernargumente */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Warum Auszubildende mit ExamFit <span className="text-gradient">sicher bestehen</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: Target, title: 'Nur Prüfungsrelevantes', text: 'Keine unnötige Theorie – du trainierst exakt das, was geprüft wird.' },
                { icon: Brain, title: 'Schwächen erkennen', text: 'Das System zeigt dir sofort, wo du noch üben musst.' },
                { icon: Zap, title: 'Prüfungsfallen meistern', text: 'Typische Fehler erkennen, bevor sie in der Prüfung passieren.' },
                { icon: TrendingUp, title: 'Prüfungsreife messen', text: 'Du weißt vor der Prüfung genau, wo du stehst.' },
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

        {/* So funktioniert's */}
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              So wirst du <span className="text-gradient">prüfungsreif</span>
            </h2>
            <div className="grid md:grid-cols-5 gap-4">
              {[
                { step: '1', label: 'Prüfung starten oder simulieren' },
                { step: '2', label: 'Echte prüfungsnahe Aufgaben bearbeiten' },
                { step: '3', label: 'Sofort Feedback erhalten' },
                { step: '4', label: 'Schwächen gezielt auffrischen' },
                { step: '5', label: 'Schritt für Schritt prüfungsreif werden' },
              ].map(({ step, label }) => (
                <div key={step} className="glass-card rounded-2xl p-5 text-center">
                  <div className="w-10 h-10 rounded-full gradient-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">
                    {step}
                  </div>
                  <p className="text-sm font-medium">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="glass-card rounded-2xl p-8">
                <Target className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-lg font-display font-bold mb-2">Prüfungssimulation</h3>
                <p className="text-sm text-muted-foreground">
                  IHK-konforme Simulationen mit Zeitbegrenzung, Gewichtung und Bestehensindikator.
                </p>
              </div>
              <div className="glass-card rounded-2xl p-8">
                <Mic className="h-10 w-10 text-accent mb-4" />
                <h3 className="text-lg font-display font-bold mb-2">Mündliche Prüfung üben</h3>
                <p className="text-sm text-muted-foreground">
                  Trainiere das Fachgespräch mit KI-Feedback zu Fachlichkeit, Struktur und Praxisbezug.
                </p>
              </div>
              <div className="glass-card rounded-2xl p-8">
                <Brain className="h-10 w-10 text-success mb-4" />
                <h3 className="text-lg font-display font-bold mb-2">KI-Prüfungscoach</h3>
                <p className="text-sm text-muted-foreground">
                  Dein Coach erklärt dir, warum eine Antwort falsch war und wie du Punkte holst.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Vertrauensanker */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-3xl text-center">
            <div className="glass-card rounded-2xl p-8">
              <p className="text-muted-foreground mb-4">
                Prüfungskonform nach Ausbildungsrahmenplan · Entwickelt für Auszubildende · Keine Schulnoten, kein Druck – nur Vorbereitung
              </p>
              <div className="flex items-baseline gap-2 justify-center mb-6">
                <span className="text-4xl font-display font-bold text-gradient">24,90 €</span>
                <span className="text-muted-foreground">einmalig</span>
              </div>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg">
                  Jetzt Prüfungstraining starten
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
