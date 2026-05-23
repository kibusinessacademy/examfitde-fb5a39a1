/**
 * Memory ↔ Known-Systems Sync — pure functions.
 *
 * Erkennt in `.lovable/memory/index.md` referenzierte SSOTs / Queues / Audits /
 * Registries / Workers / Crons / Gateways / Ledgers / Artifacts und prüft,
 * ob sie in `known-systems.ts` registriert sind.
 *
 * Pure: kein FS, kein DB, kein Supabase-Import.
 */

import { KNOWN_SYSTEMS } from './known-systems';

export const MEMORY_KEYWORDS = [
  'ssot',
  'queue',
  'audit',
  'event',
  'gateway',
  'worker',
  'cron',
  'registry',
  'ledger',
  'artifact',
] as const;

const SYSTEM_SUFFIX = /(events?|queue|log|registry|contract|ledger|gateway|worker|jobs?|outbox|grants?|entitlements?|policies|sequences?)$/i;

/**
 * Extrahiert Kandidaten-Identifier aus Memory-Text:
 *   - Tokens in Backticks (\`foo_bar\`)
 *   - snake_case-Tokens auf einer Zeile, die eines der MEMORY_KEYWORDS enthält
 *   - mind. ein "_" + Länge 6..60
 */
export function extractMemoryReferences(text: string): string[] {
  const out = new Set<string>();
  const lines = text.split(/\r?\n/);
  const backtick = /`([a-z][a-z0-9_]{5,60})`/gi;
  const snake = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,5})\b/g;
  for (const raw of lines) {
    const line = raw.toLowerCase();
    // backticks immer
    let m: RegExpExecArray | null;
    while ((m = backtick.exec(raw)) !== null) {
      const tok = m[1].toLowerCase();
      if (tok.includes('_')) out.add(tok);
    }
    backtick.lastIndex = 0;
    // snake_case nur wenn Zeile ein Keyword enthält
    if (!MEMORY_KEYWORDS.some((k) => line.includes(k))) continue;
    while ((m = snake.exec(raw)) !== null) {
      const tok = m[1];
      if (tok.length < 6 || tok.length > 60) continue;
      if (!tok.includes('_')) continue;
      // Heuristik: System-Name sieht meistens nach Suffix-Pattern aus
      if (SYSTEM_SUFFIX.test(tok) || /^(v_|fn_|admin_|ops_|trg_|cron_)/.test(tok)) {
        out.add(tok);
      }
    }
    snake.lastIndex = 0;
  }
  return Array.from(out).sort();
}

/**
 * Vergleicht extrahierte Refs gegen Registry-Namen + extensionHints.
 * Liefert pro Token: covered (true) oder missing (false).
 */
export function classifyMemoryReferences(
  refs: string[],
  knownNames: Set<string>,
  hintsCorpus: string,
): { covered: string[]; missing: string[] } {
  const covered: string[] = [];
  const missing: string[] = [];
  const corpus = hintsCorpus.toLowerCase();
  for (const r of refs) {
    if (knownNames.has(r) || corpus.includes(r)) covered.push(r);
    else missing.push(r);
  }
  return { covered, missing };
}

export function buildKnownCorpus(): { names: Set<string>; hints: string } {
  const names = new Set<string>();
  const parts: string[] = [];
  for (const s of KNOWN_SYSTEMS) {
    names.add(s.name.toLowerCase());
    parts.push(s.name, s.purpose, s.tags.join(' '), s.extensionHint ?? '');
  }
  return { names, hints: parts.join(' ').toLowerCase() };
}

/**
 * High-level: Memory-Text + Allowlist → Diff.
 */
export function syncMemoryAgainstRegistry(
  memoryText: string,
  allowlist: string[] = [],
): { covered: string[]; missing: string[]; allowed: string[] } {
  const refs = extractMemoryReferences(memoryText);
  const { names, hints } = buildKnownCorpus();
  const { covered, missing } = classifyMemoryReferences(refs, names, hints);
  const allow = new Set(allowlist.map((a) => a.toLowerCase()));
  const allowed: string[] = [];
  const realMissing: string[] = [];
  for (const m of missing) {
    if (allow.has(m)) allowed.push(m);
    else realMissing.push(m);
  }
  return { covered, missing: realMissing, allowed };
}
