export function buildSeoMeta(input: {
  title: string;
  landingType: string;
  price: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
}) {
  const priceFormatted = input.price.toFixed(2).replace('.', ',');
  return {
    title:
      input.seoTitle ??
      `${input.title} Prüfungstraining 2026 – bestehen mit Simulation & KI-Coach`,
    description:
      input.seoDescription ??
      `${input.title} gezielt bestehen: prüfungsnahe Fragen, Simulation, MiniChecks und KI-Tutor. Einmalig ${priceFormatted} €.`,
  };
}
