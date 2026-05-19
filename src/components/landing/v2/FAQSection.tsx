import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = [
  { q: "Was ist ExamFit genau?", a: "ExamFit ist ein intelligentes Prüfungstrainingssystem für IHK-, HWK- und Fortbildungsprüfungen. Es kombiniert Prüfungsreife-Analyse, adaptive Schwächenanalyse, Lernkurse, KI-Tutor, Prüfungstrainer und mündliche Simulation in einem System." },
  { q: "Wie funktioniert der kostenlose Prüfungsreife-Check?", a: "5 kurze Fragen, 4 Minuten Zeit. Danach kennst du deinen aktuellen Score, deine Stärken und genau die Themen, an denen du noch arbeiten solltest. Keine Anmeldung, keine versteckten Kosten." },
  { q: "Ist der KI-Tutor wirklich verlässlich?", a: "Ja. Der Tutor arbeitet im Strict-RAG-Modus — er antwortet ausschließlich auf Basis deines Kurses und des offiziellen Rahmenplans und nennt seine Quellen. Keine Halluzinationen, keine erfundenen Paragraphen." },
  { q: "Was bedeutet 'mündliche Prüfungssimulation'?", a: "Ein simulierter Prüfer stellt dir Fachgesprächs-Fragen, du antwortest per Sprache, und die KI bewertet Fachlichkeit, Struktur und Praxisbezug — wie in der echten IHK-Prüfung." },
  { q: "Wie viel kostet es und gibt es ein Abo?", a: "Nein, kein Abo. Du zahlst einmalig und hast 12 Monate Zugang zum Komplett-Training für deinen Beruf. Sichere Zahlung über Stripe." },
  { q: "Für welche Berufe ist ExamFit verfügbar?", a: "Über 100 Berufe von IHK-Ausbildungsberufen (Fachinformatiker, Kaufmann für Büromanagement, Industriekaufmann …) über AEVO bis zu Fortbildungen wie Bilanzbuchhalter, Fachwirt oder Betriebswirt." },
  { q: "Funktioniert das auch am Handy?", a: "Ja — mobile-first. Lernen, MiniChecks, KI-Tutor und mündliche Simulation funktionieren komplett auf dem Smartphone." },
];

export function FAQSection() {
  return (
    <section id="faq" className="py-20 sm:py-24 scroll-mt-20">
      <div className="container mx-auto max-w-3xl px-4">
        <div className="text-center mb-10">
          <span className="lp-chip">FAQ</span>
          <h2 className="lp-display mt-4 text-3xl sm:text-4xl font-bold">
            Häufige <span className="lp-gradient-text">Fragen</span>
          </h2>
        </div>
        <div className="lp-card p-2 sm:p-4">
          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border-b border-[var(--lp-border)] last:border-b-0"
              >
                <AccordionTrigger className="text-left text-[var(--lp-text)] hover:no-underline px-3 sm:px-4 py-4">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="px-3 sm:px-4 pb-4 text-[var(--lp-text-2)] leading-relaxed">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}

export const FAQ_ITEMS = FAQ.map((f) => ({ question: f.q, answer: f.a }));
