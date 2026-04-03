import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL } from '@/lib/seo';
import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  Eye,
  GraduationCap,
  Scale,
  Shield,
  Users,
} from 'lucide-react';

export default function PruefungstrainingInstitutionenPage() {
  return (
    <>
      <SEOHead
        title="IHK Prüfungstraining für Berufsschulen & Bildungsträger (2026) | ExamFit"
        description="Prüfungsvorbereitung Ausbildung online: ExamFit ergänzt den Unterricht mit adaptivem Prüfungstraining, Prüfungssimulation & KI-Coach. Curriculum-konform, neutral, prüfungsnah."
        canonical={`${SITE_URL}/pruefungstraining-institutionen`}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              Prüfungsvorbereitung, die den Unterricht{' '}
              <span className="text-gradient text-glow">ergänzt – nicht ersetzt.</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              ExamFit unterstützt Auszubildende gezielt bei der Prüfungsvorbereitung
              auf Basis des Ausbildungsrahmenplans – neutral, prüfungsnah und transparent.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/unternehmen">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg">
                  Mehr erfahren
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/berufe">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Verfügbare Berufe ansehen
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Kernargumente */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Was ExamFit für Institutionen <span className="text-gradient">leistet</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: BookOpen, title: 'Rahmenplan-Treue', text: 'Alle Inhalte orientieren sich am Ausbildungsrahmenplan.' },
                { icon: Scale, title: 'Prüfungskonformität', text: 'Fokus auf IHK-Prüfungsanforderungen – keine freien Inhalte.' },
                { icon: Eye, title: 'Transparente Stände', text: 'Kompetenzstände der Auszubildenden objektiv einsehbar.' },
                { icon: Shield, title: 'Ergänzung, kein Ersatz', text: 'Kein Unterrichtsersatz – Unterstützung zur Selbstvorbereitung.' },
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

        {/* Abgrenzung */}
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-4xl">
            <div className="glass-card rounded-2xl p-8 md:p-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold mb-6 text-center">
                Klare Abgrenzung
              </h2>
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h3 className="font-semibold text-destructive mb-3">ExamFit ist NICHT:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">✗</span>
                      Eine Lernplattform für den Unterricht
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">✗</span>
                      Konkurrenz zur Berufsschule
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">✗</span>
                      Ein didaktisches Experiment
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-success mb-3">ExamFit IST:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                      Ein individuelles Prüfungstrainings-System
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                      Zur selbstständigen Vorbereitung der Auszubildenden
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                      Transparent, neutral und prüfungsnah
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Einsatzformen */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-12">
              Mögliche <span className="text-gradient">Einsatzformen</span>
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="glass-card rounded-2xl p-6">
                <GraduationCap className="h-10 w-10 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Empfehlung</h3>
                <p className="text-sm text-muted-foreground">Als empfohlenes Tool zur individuellen Prüfungsvorbereitung.</p>
              </div>
              <div className="glass-card rounded-2xl p-6">
                <BookOpen className="h-10 w-10 text-accent mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Unterrichtsergänzung</h3>
                <p className="text-sm text-muted-foreground">Ergänzend zum Berufsschulunterricht für die Prüfungsphase.</p>
              </div>
              <div className="glass-card rounded-2xl p-6">
                <Users className="h-10 w-10 text-success mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Individuelle Förderung</h3>
                <p className="text-sm text-muted-foreground">Gezielte Unterstützung leistungsschwächerer Auszubildender.</p>
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
                <Scale className="h-16 w-16 text-primary mx-auto mb-6" />
                <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                  Informationen für Ihre Institution
                </h2>
                <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                  Erfahren Sie, wie ExamFit die Prüfungsvorbereitung Ihrer Auszubildenden
                  strukturiert und transparent unterstützt.
                </p>
                <Link to="/unternehmen">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8">
                    Informationen erhalten
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
