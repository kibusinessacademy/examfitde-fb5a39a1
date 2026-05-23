/**
 * P19 — GILScaffoldManifest
 *
 * Blueprint für automatisches Scaffolding neuer Kurse mit GIL-Features.
 * Pure data — kein DB-Zugriff. Wird von der Course-Factory (P20) konsumiert.
 *
 * Bestehende Kurse werden via Backfill-Job angereichert (siehe roadmap/P20).
 */

import { GIL_AGENT_KINDS, type GilAgentKind } from './contracts';

export interface GilScaffoldDefault {
  /** Persona key — must match existing persona enum (azubi|betrieb|institution). */
  persona: 'azubi' | 'betrieb' | 'institution';
  /** Whether the agent is enabled by default for this course type. */
  enabled: boolean;
}

export interface GilScaffoldManifest {
  manifest_version: string;
  /** Per-agent default configuration when scaffolding a new course. */
  agents: Record<GilAgentKind, { enabled_by_default: boolean; cadence_hours: number }>;
  /** Standard signal sources every new course bootstraps. */
  default_signal_sources: readonly string[];
  /** Standard competitor watchlist seed (names; resolved to ids at scaffold time). */
  default_competitor_watchlist: readonly string[];
  /** Initial research-memory seeds (topic + finding). */
  research_seeds: readonly { topic: string; finding: string; confidence: number }[];
  /** Whether the CMO briefing is auto-scheduled for a new course. */
  briefing_auto_schedule: boolean;
}

export const GIL_SCAFFOLD_MANIFEST_V1: GilScaffoldManifest = {
  manifest_version: '1.0.0',
  agents: GIL_AGENT_KINDS.reduce(
    (acc, k) => {
      acc[k] = {
        enabled_by_default: true,
        cadence_hours: k === 'executive_director' ? 24 : 6,
      };
      return acc;
    },
    {} as GilScaffoldManifest['agents'],
  ),
  default_signal_sources: [
    'rss_competitor_blog',
    'serp_change_feed',
    'social_pulse',
    'pricing_change_watcher',
    'funnel_anomaly_detector',
  ],
  default_competitor_watchlist: [],
  research_seeds: [
    {
      topic: 'persona_pain_points',
      finding: 'Azubi: Strukturmangel, Prüfungsangst. Betrieb: Bestehensquote, Kosten. Institution: Neutralität, Ergänzung.',
      confidence: 0.8,
    },
  ],
  briefing_auto_schedule: false,
};

export function validateManifest(m: GilScaffoldManifest): { ok: true } | { ok: false; reason: string } {
  if (!m.manifest_version) return { ok: false, reason: 'missing manifest_version' };
  for (const k of GIL_AGENT_KINDS) {
    if (!m.agents[k]) return { ok: false, reason: `missing agent: ${k}` };
  }
  return { ok: true };
}
