export function buildSeoMeta(input: {
  title: string;
  landingType: string;
  price: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  personaType?: string;
}) {
  const priceFormatted = input.price.toFixed(2).replace('.', ',');
  const year = new Date().getFullYear();

  // Persona-specific defaults
  if (input.personaType) {
    switch (input.personaType) {
      case "sachkunde":
        return {
          title: input.seoTitle ?? `${input.title} Sachkundeprüfung bestehen (${year})`,
          description: input.seoDescription ?? `${input.title}: Prüfungsfragen, §-Referenzen und typische Fallen. Gezielt bestehen für ${priceFormatted} €.`,
        };
      case "fachwirt":
        return {
          title: input.seoTitle ?? `${input.title} Fortbildungsprüfung bestehen (${year})`,
          description: input.seoDescription ?? `${input.title} strukturiert bestehen: Prüfungsfragen, Fallbeispiele und KI-Coach. Einmalig ${priceFormatted} €.`,
        };
      case "studium":
        return {
          title: input.seoTitle ?? `${input.title} Klausurvorbereitung (${year})`,
          description: input.seoDescription ?? `${input.title} Klausur verstehen & bestehen: Transferaufgaben, Modellvergleiche und KI-Tutor. ${priceFormatted} €.`,
        };
    }
  }

  return {
    title:
      input.seoTitle ??
      `${input.title} Prüfungstraining ${year} – bestehen mit Simulation & KI-Coach`,
    description:
      input.seoDescription ??
      `${input.title} gezielt bestehen: prüfungsnahe Fragen, Simulation, MiniChecks und KI-Tutor. Einmalig ${priceFormatted} €.`,
  };
}
