import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, generateFAQSchema } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import PricingSectionHighConvert from '@/components/pricing/PricingSectionHighConvert';

const faqs = [
  {
    question: 'Wie lange habe ich Zugang?',
    answer: 'Du hast 12 Monate ab Kaufdatum vollen Zugang zu allen Funktionen.',
  },
  {
    question: 'Gibt es ein Abo oder Kündigungsfristen?',
    answer: 'Nein. Du zahlst einmal und hast 12 Monate Zugang. Keine automatische Verlängerung, keine Kündigung nötig.',
  },
  {
    question: 'Was ist der Unterschied zwischen Ausbildung und Studium?',
    answer: 'Der Prüfungstrainer ist identisch – Inhalte und Didaktik passen sich automatisch an. Im Studium liegt der Fokus auf Fallanalysen, Transferaufgaben und akademischer Klausurvorbereitung.',
  },
  {
    question: 'Können duale Studenten über den Betrieb lizenziert werden?',
    answer: 'Ja. Duale Studenten laufen automatisch über die B2B-Lizenz des Betriebs. Ein separates Produkt ist nicht nötig.',
  },
  {
    question: 'Welche Zahlungsmethoden gibt es?',
    answer: 'Wir akzeptieren Kreditkarte, PayPal, SEPA-Lastschrift und Überweisung (für B2B).',
  },
  {
    question: 'Bekomme ich eine Rechnung?',
    answer: 'Ja, nach dem Kauf erhältst du automatisch eine ordentliche Rechnung mit ausgewiesener MwSt.',
  },
];

export default function PreisePage() {
  const structuredData = generateFAQSchema(faqs);

  return (
    <>
      <SEOHead
        title="Preise – Prüfungstraining für Ausbildung & Studium | ExamFit"
        description="ExamFit Prüfungstraining: Ausbildung ab 24,90 €, Studium ab 24,90 €. Einmalzahlung, 12 Monate Zugang, kein Abo. Team-Lizenzen für Betriebe & Hochschulen."
        canonical={`${SITE_URL}/preise`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* High-converting pricing section (hero + plans + comparison + CTA) */}
        <PricingSectionHighConvert />

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-12">
              Häufige Fragen zu Preisen & Kauf
            </h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <details
                  key={index}
                  className="glass-card rounded-2xl p-6 group cursor-pointer"
                >
                  <summary className="font-semibold list-none flex items-center justify-between">
                    {faq.question}
                    <svg
                      className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
