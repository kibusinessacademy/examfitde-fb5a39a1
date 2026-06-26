/**
 * VISUAL.LEARNING.OS — Visual Grammar (Cut 1).
 *
 * Verbindliche Formen, Icons, Linien und semantische Farben.
 * Farbe ergänzt Bedeutung, trägt sie aber NIE allein (WCAG 1.4.1).
 */
import type { VisualNodeRole, VisualEdgeKind, VisualMisconceptionKind } from "./contracts";

export type VisualShape =
  | "rectangle"
  | "rounded_box"
  | "diamond"
  | "dashed_box"
  | "badge"
  | "card"
  | "icon";

export interface NodeGrammarRule {
  shape: VisualShape;
  /** lucide-react Icon-Name. Optional. */
  icon?: string;
  /** Sichtbares Mini-Label (z.B. „Falle", „Ausnahme"). Pflicht für nicht-Standardrollen. */
  badge_label?: string;
  /** Semantisches Token aus index.css — niemals Hex/Tailwind-Farbe direkt. */
  semantic_color_token: string;
}

export const NODE_GRAMMAR: Record<VisualNodeRole, NodeGrammarRule> = {
  concept: { shape: "rectangle", semantic_color_token: "--surface-raised" },
  process_step: { shape: "rounded_box", semantic_color_token: "--primary", icon: "Workflow" },
  actor: { shape: "card", semantic_color_token: "--surface-raised", icon: "User" },
  document: { shape: "card", semantic_color_token: "--surface-raised", icon: "FileText" },
  rule: { shape: "rectangle", semantic_color_token: "--accent", icon: "Lock", badge_label: "Muss" },
  exception: { shape: "dashed_box", semantic_color_token: "--muted", icon: "AlertTriangle", badge_label: "Ausnahme" },
  risk: { shape: "rectangle", semantic_color_token: "--destructive", icon: "ShieldAlert", badge_label: "Risiko" },
  decision: { shape: "diamond", semantic_color_token: "--secondary", icon: "GitBranch" },
  example: { shape: "card", semantic_color_token: "--surface-raised", icon: "Sparkles", badge_label: "Beispiel" },
  misconception: { shape: "rectangle", semantic_color_token: "--destructive", icon: "X", badge_label: "Falle" },
};

export type EdgeLineStyle = "solid" | "dashed" | "dotted" | "thick";

export interface EdgeGrammarRule {
  line: EdgeLineStyle;
  arrow: "single" | "double" | "none";
  default_label: string;
  semantic_color_token: string;
}

export const EDGE_GRAMMAR: Record<VisualEdgeKind, EdgeGrammarRule> = {
  requires:       { line: "solid",  arrow: "single", default_label: "benötigt",        semantic_color_token: "--primary" },
  causes:         { line: "solid",  arrow: "single", default_label: "führt zu",        semantic_color_token: "--primary" },
  belongs_to:     { line: "solid",  arrow: "single", default_label: "gehört zu",       semantic_color_token: "--muted-foreground" },
  contrasts_with: { line: "dashed", arrow: "double", default_label: "vs.",             semantic_color_token: "--muted-foreground" },
  precedes:       { line: "thick",  arrow: "single", default_label: "vor",             semantic_color_token: "--primary" },
  blocks:         { line: "solid",  arrow: "single", default_label: "blockiert",       semantic_color_token: "--destructive" },
  explains:       { line: "dotted", arrow: "single", default_label: "erklärt",         semantic_color_token: "--muted-foreground" },
  exception_of:   { line: "dashed", arrow: "single", default_label: "Ausnahme von",    semantic_color_token: "--muted" },
};

export const MISCONCEPTION_BADGE: Record<VisualMisconceptionKind, { label: string; icon: string }> = {
  wrong_link:          { label: "Falsche Beziehung",     icon: "Link2Off" },
  missing_node:        { label: "Fehlender Begriff",     icon: "CircleSlash" },
  false_order:         { label: "Falsche Reihenfolge",   icon: "ArrowDownUp" },
  overgeneralization:  { label: "Übergeneralisierung",   icon: "Maximize2" },
  exception_ignored:   { label: "Ausnahme übersehen",    icon: "AlertTriangle" },
  diagram_misread:     { label: "Diagramm falsch gelesen", icon: "EyeOff" },
};

/** Begrenzung der semantischen Farben — Grammar erlaubt max. 5 + neutral. */
export const ALLOWED_SEMANTIC_COLOR_TOKENS = Object.freeze([
  "--primary",
  "--secondary",
  "--accent",
  "--destructive",
  "--muted",
  "--muted-foreground",
  "--surface-raised",
]);
