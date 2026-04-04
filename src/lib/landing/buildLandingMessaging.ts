export type LandingMessagingInput = {
  title: string;
  landingType: string;
  validationProfile: string;
  modules: {
    examTrainer: boolean;
    examSimulation: boolean;
    miniChecks: boolean;
    aiTutor: boolean;
    oralExam: boolean;
    handbook: boolean;
  };
  price: number;
};

export function buildLandingMessaging(input: LandingMessagingInput) {
  const isAEVO = input.validationProfile === "AEVO";
  const isFortbildung = input.landingType === "FORTBILDUNG";
  const isCert = input.landingType === "ZERTIFIKAT";

  const priceFormatted = input.price.toFixed(2).replace('.', ',');

  const heroHeadline = isAEVO
    ? `${input.title} sicher bestehen – mit schriftlicher und mündlicher Simulation`
    : isFortbildung
    ? `${input.title} bestehen – strukturiert, prüfungsnah und ohne Lücken`
    : isCert
    ? `${input.title} bestehen – schneller, gezielter und ohne unnötige Theorie`
    : `${input.title} bestehen – mit System statt Zufall`;

  const heroSubline = isAEVO
    ? `Trainiere echte Prüfungssituationen, typische Fehler und den mündlichen Teil – für nur ${priceFormatted} € einmalig.`
    : `Trainiere genau das, was in der Prüfung zählt – mit Simulation, Fehleranalyse und KI-Prüfungscoach für nur ${priceFormatted} € einmalig.`;

  const uspItems = [
    input.modules.examSimulation ? "Prüfungssimulation mit Bewertung" : null,
    input.modules.miniChecks ? "Gezielte MiniChecks für Schwächen" : null,
    input.modules.aiTutor ? "KI-Prüfungscoach mit Fehleranalyse" : null,
    input.modules.oralExam ? "Mündliche Prüfungssimulation" : null,
    input.modules.handbook ? "Strukturiertes Prüfungshandbuch" : null,
  ].filter(Boolean) as string[];

  const primaryCta = isCert
    ? "Jetzt Zertifizierungs-Training starten"
    : "Jetzt Prüfungstraining starten";

  const secondaryCta = "Kostenlosen Prüfungsreife-Check starten";

  return {
    heroHeadline,
    heroSubline,
    uspItems,
    primaryCta,
    secondaryCta,
  };
}
