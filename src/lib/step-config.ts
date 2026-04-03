/**
 * SSOT Step Configuration for the Learner UI.
 * All lesson-step related components MUST import from here.
 */

import {
  Lightbulb,
  BookOpen,
  PenTool,
  Eye,
  ArrowRightLeft,
  RotateCcw,
  ClipboardCheck,
} from 'lucide-react';

export interface StepConfig {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

/**
 * Canonical step order — didactic progression.
 * einstieg → verstehen → anwenden → reflektieren → transfer → wiederholen → mini_check
 */
export const STEP_ORDER = [
  'einstieg',
  'verstehen',
  'anwenden',
  'reflektieren',
  'transfer',
  'wiederholen',
  'mini_check',
] as const;

export type StepKey = (typeof STEP_ORDER)[number];

export const STEP_LABELS: Record<string, string> = {
  einstieg: 'Einstieg',
  verstehen: 'Verstehen',
  anwenden: 'Anwenden',
  reflektieren: 'Reflektieren',
  transfer: 'Transfer',
  wiederholen: 'Wiederholen',
  mini_check: 'Mini-Check',
};

export const STEP_CONFIG: Record<string, StepConfig> = {
  einstieg: {
    label: 'Einstieg',
    description: 'Aktivierung des Vorwissens',
    icon: Lightbulb,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
  },
  verstehen: {
    label: 'Verstehen',
    description: 'Neues Wissen aufnehmen',
    icon: BookOpen,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
  },
  anwenden: {
    label: 'Anwenden',
    description: 'Wissen praktisch nutzen',
    icon: PenTool,
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  reflektieren: {
    label: 'Reflektieren',
    description: 'Eigenes Verständnis hinterfragen',
    icon: Eye,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
  },
  transfer: {
    label: 'Transfer',
    description: 'Wissen auf neue Kontexte übertragen',
    icon: ArrowRightLeft,
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/20',
  },
  wiederholen: {
    label: 'Wiederholen',
    description: 'Gelerntes festigen',
    icon: RotateCcw,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
  },
  mini_check: {
    label: 'Mini-Check',
    description: 'Wissen überprüfen',
    icon: ClipboardCheck,
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/20',
  },
};
