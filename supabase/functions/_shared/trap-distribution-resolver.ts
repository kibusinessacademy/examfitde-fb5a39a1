/**
 * SSOT Trap Distribution Resolver
 *
 * Resolves the applicable trap distribution rules for a given package/curriculum.
 * Override hierarchy: Blueprint → Curriculum → Track-Default
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export interface TrapCorridor {
  trap_type: string;
  target_pct: number;
  min_pct: number;
  max_pct: number;
  warn_below_pct: number;
  hard_below_pct: number;
  source: 'blueprint' | 'curriculum' | 'track';
}

export interface TrapDistributionRuleset {
  corridors: TrapCorridor[];
  profile: string;
  resolved_from: string;
}

export type CurriculumProfile = 'calculation_heavy' | 'procedure_heavy' | 'concept_heavy' | 'mixed';

/**
 * Resolve trap distribution rules for a package.
 * Priority: curriculum-specific → track:profile → track:mixed default
 */
export async function resolveTrapDistribution(
  supabase: SupabaseClient,
  opts: { curriculumId: string; track: string; profile?: CurriculumProfile }
): Promise<TrapDistributionRuleset> {
  const { curriculumId, track, profile } = opts;

  // 1. Try curriculum-specific rules
  const { data: currRules } = await supabase
    .from('trap_distribution_rules')
    .select('*')
    .eq('scope_type', 'curriculum')
    .eq('scope_id', curriculumId);

  if (currRules && currRules.length >= 3) {
    return {
      corridors: currRules.map(r => ({
        trap_type: r.trap_type,
        target_pct: Number(r.target_pct),
        min_pct: Number(r.min_pct),
        max_pct: Number(r.max_pct),
        warn_below_pct: Number(r.warn_below_pct),
        hard_below_pct: Number(r.hard_below_pct),
        source: 'curriculum' as const,
      })),
      profile: currRules[0].curriculum_profile || 'mixed',
      resolved_from: `curriculum:${curriculumId}`,
    };
  }

  // 2. Try track + profile combo
  const effectiveProfile = profile || 'mixed';
  const profileScopeId = effectiveProfile === 'mixed' ? track : `${track}:${effectiveProfile}`;

  const { data: profileRules } = await supabase
    .from('trap_distribution_rules')
    .select('*')
    .eq('scope_type', 'track')
    .eq('scope_id', profileScopeId);

  if (profileRules && profileRules.length >= 3) {
    return {
      corridors: profileRules.map(r => ({
        trap_type: r.trap_type,
        target_pct: Number(r.target_pct),
        min_pct: Number(r.min_pct),
        max_pct: Number(r.max_pct),
        warn_below_pct: Number(r.warn_below_pct),
        hard_below_pct: Number(r.hard_below_pct),
        source: 'track' as const,
      })),
      profile: effectiveProfile,
      resolved_from: `track:${profileScopeId}`,
    };
  }

  // 3. Fallback: track default (mixed)
  const { data: defaultRules } = await supabase
    .from('trap_distribution_rules')
    .select('*')
    .eq('scope_type', 'track')
    .eq('scope_id', track);

  if (defaultRules && defaultRules.length >= 3) {
    return {
      corridors: defaultRules.map(r => ({
        trap_type: r.trap_type,
        target_pct: Number(r.target_pct),
        min_pct: Number(r.min_pct),
        max_pct: Number(r.max_pct),
        warn_below_pct: Number(r.warn_below_pct),
        hard_below_pct: Number(r.hard_below_pct),
        source: 'track' as const,
      })),
      profile: 'mixed',
      resolved_from: `track:${track}:fallback`,
    };
  }

  // 4. Hardcoded ultimate fallback (should never reach here)
  console.warn(`[trap-resolver] No rules found for track=${track}, curriculum=${curriculumId}. Using hardcoded defaults.`);
  return {
    corridors: [
      { trap_type: 'misconception',   target_pct: 35, min_pct: 25, max_pct: 45, warn_below_pct: 20, hard_below_pct: 15, source: 'track' },
      { trap_type: 'typical_error',    target_pct: 40, min_pct: 30, max_pct: 50, warn_below_pct: 25, hard_below_pct: 20, source: 'track' },
      { trap_type: 'calculation_trap', target_pct: 25, min_pct: 15, max_pct: 35, warn_below_pct: 10, hard_below_pct: 5,  source: 'track' },
    ],
    profile: 'mixed',
    resolved_from: 'hardcoded:fallback',
  };
}

/**
 * Evaluate actual distribution against rules.
 * Returns per-type verdict and overall signal.
 */
export function evaluateTrapDistribution(
  ruleset: TrapDistributionRuleset,
  actual: Record<string, number>, // trap_type → count
): {
  total: number;
  details: Array<{
    trap_type: string;
    actual_pct: number;
    target_pct: number;
    signal: 'ok' | 'warn' | 'hard_fail';
    reason?: string;
  }>;
  overall: 'ok' | 'warn' | 'hard_fail';
} {
  const total = Object.values(actual).reduce((s, v) => s + v, 0);
  if (total === 0) {
    return { total: 0, details: [], overall: 'hard_fail' };
  }

  const details = ruleset.corridors.map(c => {
    const count = actual[c.trap_type] || 0;
    const pct = (count / total) * 100;

    let signal: 'ok' | 'warn' | 'hard_fail' = 'ok';
    let reason: string | undefined;

    if (pct < c.hard_below_pct) {
      signal = 'hard_fail';
      reason = `${c.trap_type}: ${pct.toFixed(1)}% < hard_below ${c.hard_below_pct}%`;
    } else if (pct < c.warn_below_pct) {
      signal = 'warn';
      reason = `${c.trap_type}: ${pct.toFixed(1)}% < warn ${c.warn_below_pct}%`;
    } else if (pct > c.max_pct) {
      signal = 'warn';
      reason = `${c.trap_type}: ${pct.toFixed(1)}% > max ${c.max_pct}%`;
    }

    return { trap_type: c.trap_type, actual_pct: Math.round(pct * 10) / 10, target_pct: c.target_pct, signal, reason };
  });

  const hardFails = details.filter(d => d.signal === 'hard_fail').length;
  const warns = details.filter(d => d.signal === 'warn').length;

  let overall: 'ok' | 'warn' | 'hard_fail' = 'ok';
  if (hardFails > 0 || warns >= 2) overall = 'hard_fail';
  else if (warns > 0) overall = 'warn';

  return { total, details, overall };
}
