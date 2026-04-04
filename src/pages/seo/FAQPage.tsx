import { useState } from 'react';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL, generateFAQSchema } from '@/lib/seo';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, HelpCircle, CreditCard, BookOpen, GraduationCap, Shield, Settings } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqs: FAQItem[] = [
  // Allgemein
  {
    category: 'Allgemein',
    question: 'Was ist ExamFit?',
    answer: 'ExamFit ist ein intelligentes Prüfungstrainings-System für Auszubildende. Es vereint Prüfungssimulation, prüfungsrelevantes Wissen, KI-Tutor und mündliche Prüfungsvorbereitung in einem Produkt. Wir sind kein offizieller Partner der IHK oder HWK.',
  },
  {
    category: 'Allgemein',
    question: 'Für welche Berufe bietet ExamFit Prüfungstraining an?',
    answer: 'Wir decken eine wachsende Anzahl von IHK-Ausbildungsberufen ab, darunter Kaufleute für Büromanagement, Industriekaufleute, IT-Berufe und viele weitere. Auf unserer Berufe-Seite findest du die vollständige Übersicht.',
  },
  {
    category: 'Allgemein',
    question: 'Basieren die Inhalte auf offiziellen Prüfungsanforderungen?',
    answer: 'Ja, alle Inhalte basieren auf den öffentlich zugänglichen Rahmenlehrplänen und Prüfungsordnungen. Wir aktualisieren die Inhalte regelmäßig. Bitte beachte: ExamFit ist ein unabhängiger Anbieter ohne offizielle Verbindung zur IHK oder HWK.',
  },

  // Produkt
  {
    category: 'Produkt',
    question: 'Was beinhaltet das ExamFit Prüfungstraining?',
    answer: 'Das Prüfungstraining ist ein Gesamtpaket: Prüfungssimulation mit IHK-konformen Aufgaben, prüfungsrelevantes Wissen zu allen Lernfeldern, ein KI-Tutor für Prüfungsfragen und eine mündliche Prüfungssimulation mit KI-Feedback.',
  },
  {
    category: 'Produkt',
    question: 'Wie funktioniert die mündliche Prüfungssimulation?',
    answer: 'Unser KI-Prüfer stellt dir berufsspezifische Fragen und gibt dir individuelles Feedback zu deinen Antworten. Du kannst üben, wie du in einer echten Prüfungssituation reagierst und wirst auf typische Fragen vorbereitet.',
  },
  {
    category: 'Produkt',
    question: 'Was ist der KI-Tutor?',
    answer: 'Der KI-Tutor ist dein persönlicher Prüfungscoach. Er beantwortet Fragen zu prüfungsrelevanten Themen, erklärt typische Prüfungsfehler und hilft dir bei Verständnisproblemen – rund um die Uhr verfügbar.',
  },

  // Preise & Zahlung
  {
    category: 'Preise & Zahlung',
    question: 'Was kostet das Prüfungstraining?',
    answer: 'Das komplette Prüfungstraining kostet 24,90€ als Einmalzahlung für 12 Monate Zugang. Alle Funktionen sind enthalten – keine versteckten Kosten.',
  },
  {
    category: 'Preise & Zahlung',
    question: 'Ist ExamFit ein Abo?',
    answer: 'Nein! Du zahlst einmal und hast 12 Monate vollen Zugang. Es gibt keine automatische Verlängerung, keine wiederkehrenden Zahlungen und keine Kündigungsfristen.',
  },
  {
    category: 'Preise & Zahlung',
    question: 'Welche Zahlungsmethoden gibt es?',
    answer: 'Wir akzeptieren Kreditkarte, PayPal, SEPA-Lastschrift, Apple Pay und Google Pay. Für Unternehmen bieten wir auch Zahlung auf Rechnung an.',
  },
  {
    category: 'Preise & Zahlung',
    question: 'Bekomme ich eine Rechnung?',
    answer: 'Ja, nach dem Kauf erhältst du automatisch eine ordnungsgemäße Rechnung mit ausgewiesener Mehrwertsteuer per E-Mail.',
  },
  {
    category: 'Preise & Zahlung',
    question: 'Gibt es Mengenrabatte für Unternehmen?',
    answer: 'Ja, ab 5 Lizenzen erhältst du automatisch gestaffelte Rabatte bis zu 25%. Die Rabatte werden direkt im Checkout berechnet.',
  },

  // Nutzung
  {
    category: 'Nutzung',
    question: 'Wie lange habe ich Zugang zu den Inhalten?',
    answer: '12 Monate ab Kaufdatum. Das gibt dir genügend Zeit, dich optimal auf deine Prüfung vorzubereiten.',
  },
  {
    category: 'Nutzung',
    question: 'Kann ich ExamFit auf dem Smartphone nutzen?',
    answer: 'Ja, ExamFit ist vollständig mobiloptimiert. Du kannst die Web-App nutzen oder sie als App auf deinem Startbildschirm installieren. So kannst du auch unterwegs lernen.',
  },
  {
    category: 'Nutzung',
    question: 'Benötige ich eine Internetverbindung?',
    answer: 'Ja, für die Nutzung der Plattform ist eine Internetverbindung erforderlich. Offline-Nutzung ist derzeit nicht möglich.',
  },
  {
    category: 'Nutzung',
    question: 'Kann ich meinen Account mit anderen teilen?',
    answer: 'Nein, die Lizenz ist an eine Person gebunden. Die Weitergabe von Zugangsdaten ist nicht gestattet und kann zur Sperrung des Accounts führen.',
  },

  // Prüfung
  {
    category: 'Prüfungsvorbereitung',
    question: 'Wann sollte ich mit der IHK Prüfungsvorbereitung beginnen?',
    answer: 'Wir empfehlen, 3-6 Monate vor der Prüfung zu starten. So hast du genug Zeit für gründliches Lernen und Wiederholen. Unser adaptives Prüfungstraining hilft dir, die Zeit optimal zu nutzen.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Sind die Prüfungsfragen identisch mit den echten IHK Prüfungsaufgaben?',
    answer: 'Unsere Fragen orientieren sich an Inhalt, Stil und Schwierigkeitsgrad der offiziellen IHK-Abschlussprüfungen. Da die Prüfungen urheberrechtlich geschützt sind, verwenden wir keine Originalfragen, sondern vergleichbare prüfungsnahe Fragen zu allen relevanten Themen.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Wie bestehe ich die IHK Abschlussprüfung sicher?',
    answer: 'Drei Schlüssel zum Bestehen: 1) Früh anfangen (3-6 Monate vorher), 2) Prüfungssimulation nutzen statt nur Theorie lesen, 3) Schwächen gezielt trainieren. ExamFit kombiniert alle drei Ansätze in einem System.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Welche typischen Fehler sollte ich bei der IHK Prüfung vermeiden?',
    answer: 'Die häufigsten Fehler: Zu spät mit der Vorbereitung beginnen, nur passiv Theorie lesen, keine Prüfungssimulation machen, Zeitmanagement nicht üben und Schwächen ignorieren. ExamFit hilft dir, alle diese Fehler zu vermeiden.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Kann ich die IHK Prüfung online simulieren?',
    answer: 'Ja. ExamFit bietet eine realistische IHK-Prüfungssimulation online: echte Zeitvorgaben, prüfungskonforme Aufgabentypen, Bestehensindikator und sofortige Auswertung deiner Schwächen.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Gibt es IHK Prüfungsaufgaben mit Lösungen zum Üben?',
    answer: 'Ja, ExamFit bietet hunderte prüfungsnahe Aufgaben mit ausführlichen Lösungen und Erklärungen. Der KI-Coach erklärt dir zusätzlich, warum eine Antwort richtig oder falsch ist.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Was ist der "Schwächenmodus"?',
    answer: 'Der Schwächenmodus analysiert deine bisherigen Antworten und stellt dir gezielt Fragen zu Themen, bei denen du noch Verbesserungspotenzial hast. So lernst du effektiver.',
  },
  {
    category: 'Prüfungsvorbereitung',
    question: 'Garantiert ExamFit das Bestehen der IHK Prüfung?',
    answer: 'Wir können kein Bestehen garantieren, da der Prüfungserfolg von vielen Faktoren abhängt. Unsere Statistik zeigt jedoch, dass 98% unserer aktiven Nutzer ihre IHK-Prüfung bestehen.',
  },

  // Technisch
  {
    category: 'Technisches',
    question: 'In welchen Browsern funktioniert ExamFit?',
    answer: 'ExamFit funktioniert in allen modernen Browsern: Chrome, Firefox, Safari, Edge (jeweils aktuelle Versionen). Wir empfehlen Chrome oder Safari für die beste Erfahrung.',
  },
  {
    category: 'Technisches',
    question: 'Meine Fortschritte werden nicht gespeichert. Was tun?',
    answer: 'Stelle sicher, dass du angemeldet bist und Cookies aktiviert sind. Bei Problemen melde dich ab und wieder an. Kontaktiere unseren Support, wenn das Problem bestehen bleibt.',
  },

  // Widerruf
  {
    category: 'Widerruf & Support',
    question: 'Kann ich mein Produkt zurückgeben?',
    answer: 'Du hast ein 14-tägiges Widerrufsrecht ab Kaufdatum. Beachte: Das Widerrufsrecht erlischt, sobald du mit der Nutzung der digitalen Inhalte beginnst und dem zugestimmt hast.',
  },
  {
    category: 'Widerruf & Support',
    question: 'Wie erreiche ich den Support?',
    answer: 'Du erreichst uns per E-Mail an support@examfit.de. Wir antworten in der Regel innerhalb von 24 Stunden an Werktagen.',
  },
  {
    category: 'Allgemein',
    question: 'Ist ExamFit ein offizieller Partner der IHK oder HWK?',
    answer: 'Nein. ExamFit ist ein unabhängiger Anbieter von Lernmaterialien. Es besteht keine Zusammenarbeit, Partnerschaft oder offizielle Verbindung mit der Industrie- und Handelskammer (IHK) oder der Handwerkskammer (HWK). Alle Inhalte basieren auf öffentlich zugänglichen Rahmenlehrplänen.',
  },
];

const categories = [
  { name: 'Alle', icon: HelpCircle },
  { name: 'Allgemein', icon: HelpCircle },
  { name: 'Produkt', icon: BookOpen },
  { name: 'Preise & Zahlung', icon: CreditCard },
  { name: 'Nutzung', icon: Settings },
  { name: 'Prüfungsvorbereitung', icon: GraduationCap },
  { name: 'Technisches', icon: Settings },
  { name: 'Widerruf & Support', icon: Shield },
];

export default function FAQPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Alle');

  const filteredFaqs = faqs.filter(faq => {
    const matchesSearch = searchQuery === '' || 
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'Alle' || faq.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const structuredData = generateFAQSchema(faqs);

  return (
    <>
      <SEOHead
        title="IHK Prüfung Fragen und Antworten – FAQ | ExamFit"
        description="Häufige Fragen zur IHK Prüfungsvorbereitung: Wie bestehe ich die IHK Abschlussprüfung? Was kostet Prüfungstraining? Tipps, Preise & Erfahrungen."
        canonical={`${SITE_URL}/faq`}
        structuredData={structuredData}
      />

      <div className="min-h-screen py-12">
        <div className="container max-w-4xl">
          <Breadcrumbs
            items={[{ label: 'Häufige Fragen' }]}
            className="mb-8"
          />

          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
              IHK Prüfung: Häufige Fragen <span className="text-gradient">& Antworten</span>
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Alles, was du über die IHK Prüfungsvorbereitung wissen musst: Tipps, Kosten, 
              Prüfungsablauf und wie du mit ExamFit deine Abschlussprüfung sicher bestehst.
            </p>
          </div>

          {/* Search */}
          <div className="relative mb-8">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Frage suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 text-base"
              aria-label="FAQ durchsuchen"
            />
          </div>

          {/* Category Filters */}
          <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label="Kategorien filtern">
            {categories.map((category) => (
              <Badge
                key={category.name}
                variant={selectedCategory === category.name ? 'default' : 'outline'}
                className="cursor-pointer py-2 px-4 text-sm transition-colors"
                onClick={() => setSelectedCategory(category.name)}
                role="button"
                aria-pressed={selectedCategory === category.name}
              >
                {category.name}
              </Badge>
            ))}
          </div>

          {/* FAQ List */}
          {filteredFaqs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Keine Fragen gefunden. Versuche eine andere Suche.</p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="space-y-3">
              {filteredFaqs.map((faq, index) => (
                <AccordionItem 
                  key={index} 
                  value={`item-${index}`}
                  className="glass-card rounded-xl border-0 px-6"
                >
                  <AccordionTrigger className="text-left hover:no-underline py-5">
                    <div className="flex items-start gap-3">
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {faq.category}
                      </Badge>
                      <span className="font-medium">{faq.question}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground pb-5 pl-[calc(theme(spacing.3)+4rem)]">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}

          {/* Contact CTA */}
          <div className="mt-16 text-center glass-card rounded-2xl p-8">
            <h2 className="text-xl font-semibold mb-2">Deine Frage nicht gefunden?</h2>
            <p className="text-muted-foreground mb-4">
              Kontaktiere uns direkt – wir helfen dir gerne weiter.
            </p>
            <a 
              href="mailto:support@examfit.de" 
              className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
            >
              support@examfit.de
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
