import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { PRICING } from '@/config/pricing';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  BookOpen, 
  CheckCircle, 
  Target, 
  Brain,
  AlertTriangle,
  Mic,
  Calendar,
  ArrowRight,
  Star,
  Users,
  Shield,
  Clock,
  Sparkles,
  GraduationCap
} from 'lucide-react';

const chapters = [
  {
    icon: BookOpen,
    title: 'Die Prüfung verstehen',
    description: 'Wie Abschlussprüfungen aufgebaut sind, was wirklich zählt und welche Fallen auf dich warten.',
  },
  {
    icon: Brain,
    title: 'Lernstrategie nach Azubi-Typ',
    description: 'Ob wenig Zeit, Prüfungsangst oder Wiederholer – finde deine optimale Strategie.',
  },
  {
    icon: Target,
    title: 'Prüfungsstrategie (schriftlich)',
    description: 'Zeitmanagement, Ausschlussverfahren und wie du auch bei Unsicherheit Punkte holst.',
  },
  {
    icon: AlertTriangle,
    title: 'Typische Prüfungsfehler',
    description: 'Die häufigsten Denkfehler, die Azubis Punkte kosten – und wie du sie vermeidest.',
  },
  {
    icon: Mic,
    title: 'Mündliche Prüfung meistern',
    description: 'Antwortstruktur, Körpersprache und souveräner Umgang mit schwierigen Fragen.',
  },
  {
    icon: Calendar,
    title: '30-Tage-Prüfungsplan',
    description: 'Dein konkreter Fahrplan für die letzten 30 Tage vor der Prüfung.',
  },
];

const benefits = [
  {
    icon: Shield,
    title: 'Weniger Prüfungsangst',
    description: 'Du weißt genau, was auf dich zukommt – und wie du damit umgehst.',
  },
  {
    icon: Target,
    title: 'Mehr Punkte',
    description: 'Strategisches Vorgehen statt blindem Lernen – so holst du das Maximum raus.',
  },
  {
    icon: Clock,
    title: 'Zeit sparen',
    description: 'Fokussiere dich auf das, was wirklich zählt – nicht auf alles.',
  },
];

export default function HandbookLandingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Prüfungstraining-Handbuch – Bestehen mit System",
    "description": "Strategischer Begleiter zur Abschlussprüfung. Verstehe die Prüfungslogik, vermeide typische Fehler und bestehe mit System.",
    "brand": { "@type": "Brand", "name": "ExamFit" },
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "EUR",
      "description": `Im Bundle enthalten (${PRICING.defaultPrice})`,
      "availability": "https://schema.org/InStock"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": "127"
    }
  };

  return (
    <>
      <SEOHead
        title="Prüfungstraining-Handbuch – Bestehen mit System | ExamFit.de"
        description="Dein strategischer Begleiter zur Abschlussprüfung: Verstehe die Prüfungslogik, vermeide typische Fehler und gehe mit einem klaren 30-Tage-Plan in die Prüfung."
        canonical="https://examfit.de/pruefungshandbuch"
        structuredData={jsonLd}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-20 lg:py-32 overflow-hidden bg-gradient-to-b from-primary/5 to-background">
          <div className="absolute inset-0 bg-grid-pattern opacity-5" />
          <div className="container mx-auto px-4 relative">
            <div className="max-w-4xl mx-auto text-center">
              <Badge variant="outline" className="mb-6 gap-2 px-4 py-2">
                <Sparkles className="h-4 w-4" />
                Im Bundle enthalten
              </Badge>
              
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
                <span className="text-gradient">Prüfungstraining-Handbuch</span>
                <br />
                <span className="text-3xl md:text-4xl text-muted-foreground font-normal">
                  Bestehen mit System
                </span>
              </h1>
              
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Nicht nur lernen – <strong>richtig lernen</strong>. Verstehe, wie die IHK prüft, 
                vermeide typische Fehler und gehe mit einem klaren Plan in deine Prüfung.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                <Button asChild size="lg" className="gap-2 text-lg px-8">
                  <Link to="/shop">
                    Jetzt im Bundle sichern
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="gap-2">
                  <Link to="/handbuch">
                    <BookOpen className="h-5 w-5" />
                    Kapitel ansehen
                  </Link>
                </Button>
              </div>

              {/* Trust Indicators */}
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/60 border-2 border-background flex items-center justify-center text-xs text-primary-foreground font-medium">
                        {String.fromCharCode(65 + i)}
                      </div>
                    ))}
                  </div>
                  <span>2.500+ Azubis nutzen ExamFit</span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                  <span className="ml-1">4.9/5 Bewertung</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem-Solution */}
        <section className="py-20 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div>
                  <Badge variant="outline" className="mb-4">Das Problem</Badge>
                  <h2 className="text-3xl font-bold mb-4">
                    Warum fallen so viele durch?
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    Es liegt selten am fehlenden Wissen. Die meisten Azubis scheitern an:
                  </p>
                  <ul className="space-y-3 text-muted-foreground">
                    <li className="flex items-start gap-3">
                      <span className="text-red-500 mt-1">✗</span>
                      <span>Falscher Priorisierung – sie lernen das Falsche</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-red-500 mt-1">✗</span>
                      <span>Typischen Denkfehlern – die sie nicht kennen</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-red-500 mt-1">✗</span>
                      <span>Zeitdruck – weil sie keine Strategie haben</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-red-500 mt-1">✗</span>
                      <span>Prüfungsangst – weil sie nicht wissen, was kommt</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <Badge variant="outline" className="mb-4 border-green-500 text-green-600">Die Lösung</Badge>
                  <h2 className="text-3xl font-bold mb-4">
                    Das Handbuch ändert das
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    Es zeigt dir nicht WAS du lernen sollst (das macht der Lernkurs), 
                    sondern WIE du strategisch vorgehst:
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>Verstehe, wie die IHK denkt und bewertet</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>Erkenne typische Fallen, bevor du reintappst</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>Nutze Zeitmanagement und Ausschlussverfahren</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>Folge einem klaren 30-Tage-Plan</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Chapters */}
        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <Badge variant="outline" className="mb-4">6 Kapitel</Badge>
              <h2 className="text-3xl font-bold mb-4">Was du lernst</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Jedes Kapitel ist praxisnah, kompakt und mit Übungen versehen, 
                die dein strategisches Denken trainieren.
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {chapters.map((chapter, index) => (
                <Card key={index} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-primary/10 rounded-xl">
                        <chapter.icon className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <Badge variant="secondary" className="mb-2">
                          Kapitel {index + 1}
                        </Badge>
                        <CardTitle className="text-lg">{chapter.title}</CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {chapter.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-20 bg-primary/5">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Dein Vorteil</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {benefits.map((benefit, index) => (
                <div key={index} className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-2xl flex items-center justify-center">
                    <benefit.icon className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{benefit.title}</h3>
                  <p className="text-muted-foreground">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* For Companies */}
        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto glass-card rounded-2xl p-8 md:p-12">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 bg-primary/10 rounded-xl">
                  <Users className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <Badge variant="outline" className="mb-2">Für Unternehmen</Badge>
                  <h2 className="text-2xl font-bold">
                    Standardisierte Prüfungsvorbereitung für alle Azubis
                  </h2>
                </div>
              </div>
              <p className="text-muted-foreground mb-6">
                Mit dem Prüfungstraining-Handbuch lernen alle Ihre Auszubildenden nach 
                derselben bewährten Strategie. Weniger Nachfragen, einheitliche Qualität, 
                bessere Ergebnisse.
              </p>
              <ul className="grid md:grid-cols-2 gap-4 mb-8">
                <li className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Einheitliche Lernstrategie</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Weniger Betreuungsaufwand</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Messbare Ergebnisse</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Im Bundle für alle Azubis</span>
                </li>
              </ul>
              <Button asChild size="lg">
                <Link to="/shop" className="gap-2">
                  Mengenrabatte anfragen
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-gradient-to-b from-background to-primary/5">
          <div className="container mx-auto px-4 text-center">
            <div className="max-w-2xl mx-auto">
              <GraduationCap className="h-16 w-16 mx-auto mb-6 text-primary" />
              <h2 className="text-3xl font-bold mb-4">
                Bereit für deine IHK-Prüfung?
              </h2>
              <p className="text-xl text-muted-foreground mb-8">
                Das Prüfungstraining-Handbuch ist im Bundle enthalten – 
                zusammen mit Lernkurs und Prüfungstrainer.
              </p>
              <Button asChild size="lg" className="gap-2 text-lg px-8">
                <Link to="/shop">
                  Bundle für {PRICING.defaultPrice} sichern
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground mt-4">
                Einmalzahlung · 12 Monate Zugang · Keine Folgekosten
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
