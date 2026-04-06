export type LandingMessagingInput = {
  title: string;
  landingType: string;
  validationProfile: string;
  personaType?: string;
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
  const persona = input.personaType;

  const priceFormatted = input.price.toFixed(2).replace('.', ',');

  // Persona-specific hero messaging
  let heroHeadline: string;
  let heroSubline: string;

  if (persona === "sachkunde") {
    heroHeadline = `${input.title} bestehen – schnell, gezielt und ohne unnötige Theorie`;
    heroSubline = `Trainiere echte Prüfungsfragen und typische Fallen – für nur ${priceFormatted} € einmalig.`;
  } else if (persona === "fachwirt") {
    heroHeadline = `${input.title} bestehen – strukturiert, praxisnah und mit System`;
    heroSubline = `Bereite dich mit Prüfungsfragen, Fallbeispielen und KI-Coaching auf die IHK-Fortbildungsprüfung vor – ${priceFormatted} € einmalig.`;
  } else if (persona === "studium") {
    heroHeadline = `${input.title} Klausur bestehen – verstehen statt auswendig lernen`;
    heroSubline = `KI-gestütztes Klausurtraining mit Transferaufgaben und Modellvergleichen – ${priceFormatted} € einmalig.`;
  } else if (isAEVO) {
    heroHeadline = `${input.title} sicher bestehen – mit schriftlicher und mündlicher Simulation`;
    heroSubline = `Trainiere echte Prüfungssituationen, typische Fehler und den mündlichen Teil – für nur ${priceFormatted} € einmalig.`;
  } else if (isFortbildung) {
    heroHeadline = `${input.title} bestehen – strukturiert, prüfungsnah und ohne Lücken`;
    heroSubline = `Trainiere genau das, was in der Prüfung zählt – mit Simulation, Fehleranalyse und KI-Prüfungscoach für nur ${priceFormatted} € einmalig.`;
  } else if (isCert) {
    heroHeadline = `${input.title} bestehen – schneller, gezielter und ohne unnötige Theorie`;
    heroSubline = `Trainiere genau das, was in der Prüfung zählt – mit Simulation, Fehleranalyse und KI-Prüfungscoach für nur ${priceFormatted} € einmalig.`;
  } else {
    heroHeadline = `${input.title} bestehen – mit System statt Zufall`;
    heroSubline = `Trainiere genau das, was in der Prüfung zählt – mit Simulation, Fehleranalyse und KI-Prüfungscoach für nur ${priceFormatted} € einmalig.`;
  }

  const uspItems = [
    input.modules.examSimulation ? "Prüfungssimulation mit Bewertung" : null,
    input.modules.miniChecks ? "Gezielte MiniChecks für Schwächen" : null,
    input.modules.aiTutor ? "KI-Prüfungscoach mit Fehleranalyse" : null,
    input.modules.oralExam ? "Mündliche Prüfungssimulation" : null,
    input.modules.handbook ? "Strukturiertes Prüfungshandbuch" : null,
  ].filter(Boolean) as string[];

  let primaryCta: string;
  if (persona === "sachkunde") primaryCta = "Jetzt Sachkunde-Training starten";
  else if (persona === "fachwirt") primaryCta = "Jetzt Fortbildungstraining starten";
  else if (persona === "studium") primaryCta = "Jetzt Klausurtraining starten";
  else if (isCert) primaryCta = "Jetzt Zertifizierungs-Training starten";
  else primaryCta = "Jetzt Prüfungstraining starten";

  const secondaryCta = "Kostenlosen Prüfungsreife-Check starten";

  return {
    heroHeadline,
    heroSubline,
    uspItems,
    primaryCta,
    secondaryCta,
  };
}
