export type CategoryKey =
  | "lernstand"
  | "pruefungspraxis"
  | "zeitmanagement"
  | "schriftliche_sicherheit"
  | "muendliche_sicherheit"
  | "typische_fehler"
  | "wiederholungssystem"
  | "pruefungsangst";

export interface Question {
  id: string;
  category: CategoryKey;
  text: string;
  /** Optional MC stage from blueprint set (Phase 2). Only present when SSOT-RPC liefert valide options + correct index. */
  mc?: {
    options: string[];
    correctIndex: number;
  };
}

export interface AnswerOption {
  label: string;
  short: string;
  score: 0 | 1 | 2 | 3;
}

export const ANSWER_OPTIONS: AnswerOption[] = [
  { label: "Gar nicht / Nein", short: "Gar nicht", score: 0 },
  { label: "Eher unsicher", short: "Unsicher", score: 1 },
  { label: "Teilweise", short: "Teilweise", score: 2 },
  { label: "Sicher / Ja", short: "Sicher", score: 3 },
];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  lernstand: "Lernstand",
  pruefungspraxis: "Prüfungspraxis",
  zeitmanagement: "Zeitmanagement",
  schriftliche_sicherheit: "Schriftliche Sicherheit",
  muendliche_sicherheit: "Mündliche Sicherheit",
  typische_fehler: "Typische Fehler",
  wiederholungssystem: "Wiederholungssystem",
  pruefungsangst: "Prüfungssicherheit",
};

export const QUESTIONS: Question[] = [
  { id: "q1", category: "lernstand", text: "Wie sicher fühlst du dich bei prüfungsnahen Aufgaben?" },
  { id: "q2", category: "pruefungspraxis", text: "Hast du bereits eine komplette Prüfung unter Zeitlimit simuliert?" },
  { id: "q3", category: "typische_fehler", text: "Weißt du, welche Themen dir aktuell die meisten Punkte kosten?" },
  { id: "q4", category: "muendliche_sicherheit", text: "Kannst du Fachbegriffe mündlich sicher erklären?" },
  { id: "q5", category: "zeitmanagement", text: "Hast du einen konkreten Lernplan bis zur Prüfung?" },
  { id: "q6", category: "schriftliche_sicherheit", text: "Bekommst du nach Aufgaben verständliches Feedback?" },
  { id: "q7", category: "wiederholungssystem", text: "Wiederholst du gezielt deine schwächsten Themen?" },
  { id: "q8", category: "pruefungsangst", text: "Wie sicher fühlst du dich insgesamt vor der Prüfung?" },
];

export type RiskLevel = "high" | "medium" | "soft" | "ready";

export interface ResultMeta {
  level: RiskLevel;
  badge: string;
  headline: string;
  tone: "danger" | "warning" | "info" | "success";
}

export function classifyScore(score: number): ResultMeta {
  if (score < 40)
    return { level: "high", badge: "Hohes Prüfungsrisiko", headline: "Du startest gerade erst — und das ist okay.", tone: "danger" };
  if (score < 65)
    return { level: "medium", badge: "Noch nicht prüfungsreif", headline: "Du hast eine Basis, aber noch große Lücken.", tone: "warning" };
  if (score < 80)
    return { level: "soft", badge: "Solide Basis, aber Lücken", headline: "Solide — der Feinschliff entscheidet.", tone: "info" };
  return { level: "ready", badge: "Gute Prüfungsreife", headline: "Du wirkst prüfungsreif. Halte das Niveau.", tone: "success" };
}
