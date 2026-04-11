import type { ProductPageSSOT, HowItWorksStep } from '@/types/product-page';

const DEFAULT_STEPS: HowItWorksStep[] = [
  { step: 1, title: 'Starte eine Prüfung oder Simulation', copy: 'Wähle dein Prüfungsgebiet und lege los.' },
  { step: 2, title: 'Bearbeite echte Prüfungsaufgaben', copy: 'Prüfungsnahe Fragen unter realistischen Bedingungen.' },
  { step: 3, title: 'Erhalte sofortiges Feedback', copy: 'Sieh deine Fehler und verstehe die richtige Lösung.' },
  { step: 4, title: 'Trainiere deine Schwächen', copy: 'Der KI-Coach erkennt Lücken und trainiert gezielt.' },
  { step: 5, title: 'Werde prüfungsreif', copy: 'Schritt für Schritt zur sicheren Bestehenschance.' },
];

interface Props {
  product: ProductPageSSOT;
}

export function ProductHowItWorksBlock({ product }: Props) {
  const headline = product.howItWorksHeadline || 'So wirst du prüfungsreif';
  const steps = product.howItWorksSteps.length > 0 ? product.howItWorksSteps : DEFAULT_STEPS;

  return (
    <section className="py-12 md:py-16 bg-muted/30 rounded-3xl mx-2 sm:mx-0">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">So funktioniert's</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">{headline}</h2>
          {product.howItWorksCopy && (
            <p className="text-muted-foreground mt-2">{product.howItWorksCopy}</p>
          )}
        </div>

        <div className="space-y-4">
          {steps.map((s) => (
            <div key={s.step} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                {s.step}
              </div>
              <div>
                <p className="text-base font-medium">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
