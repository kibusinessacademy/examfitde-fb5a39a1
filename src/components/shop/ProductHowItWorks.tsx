const STEPS = [
  { num: '1', text: 'Du startest eine Prüfung oder Simulation' },
  { num: '2', text: 'Du bekommst echte prüfungsnahe Aufgaben' },
  { num: '3', text: 'Du siehst sofort deine Fehler' },
  { num: '4', text: 'Du verstehst typische Prüfungsfallen' },
  { num: '5', text: 'Du wirst Schritt für Schritt prüfungsreif' },
];

export function ProductHowItWorks() {
  return (
    <section className="py-12 md:py-16 bg-muted/30 rounded-3xl mx-2 sm:mx-0">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">So funktioniert's</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">
            In 5 Schritten zur Prüfungsreife
          </h2>
        </div>

        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gradient-to-b from-primary/60 via-primary/30 to-primary/10 rounded-full" />

          <div className="space-y-4">
            {STEPS.map((step) => (
              <div key={step.num} className="flex items-center gap-4 relative">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0 relative z-10 ring-4 ring-background">
                  {step.num}
                </div>
                <p className="text-base font-medium">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
