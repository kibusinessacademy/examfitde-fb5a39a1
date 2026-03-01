/**
 * BerufsKI Content JSON Schema
 * 
 * Structured content format for PDF rendering.
 * The AI generator produces this shape; the PDF renderer consumes it.
 */

export interface ContentMeta {
  berufName: string;
  tier: "9" | "19" | "29";
  productTitle: string;
  valuePromise: string; // e.g. "Spare 3–7 Stunden/Woche..."
}

export interface TocItem {
  id: string;
  label: string;
}

export interface IntroSection {
  type: "intro";
  id: string;
  title: string;
  paragraphs: string[];
}

export interface TimewastersSection {
  type: "timewasters";
  id: string;
  title: string;
  bullets: string[];
  quickWins: string[];
}

export interface PromptItem {
  name: string;
  whenToUse: string;
  prompt: string;
  lernfeldRef?: string;
}

export interface PromptsSection {
  type: "prompts";
  id: string;
  title: string;
  items: PromptItem[];
}

export interface WorkflowItem {
  name: string;
  goal: string;
  steps: string[];
  output: string[];
}

export interface WorkflowsSection {
  type: "workflows";
  id: string;
  title: string;
  flows: WorkflowItem[];
}

export interface CaseItem {
  situation: string;
  input: string;
  output: string;
  pitfalls: string[];
  kompetenzRef?: string;
  zeitersparnisMin?: number;
}

export interface CasesSection {
  type: "cases";
  id: string;
  title: string;
  cases: CaseItem[];
}

export interface DsgvoSection {
  type: "dsgvo";
  id: string;
  title: string;
  rules: { rule: string; explanation: string; risk: string }[];
}

export interface ChecklistSection {
  type: "checklist";
  id: string;
  title: string;
  items: string[];
}

export interface TableSection {
  type: "table";
  id: string;
  title: string;
  headers: string[];
  rows: string[][];
}

export type ContentSection =
  | IntroSection
  | TimewastersSection
  | PromptsSection
  | WorkflowsSection
  | CasesSection
  | DsgvoSection
  | ChecklistSection
  | TableSection;

export interface ContentJson {
  meta: ContentMeta;
  toc: TocItem[];
  sections: ContentSection[];
}
