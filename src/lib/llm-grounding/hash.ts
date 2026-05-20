/**
 * Phase P2 — deterministic, dependency-free FNV-1a hash for chunk ids.
 *
 * Identical inputs MUST produce identical ids across runs and machines.
 */

export function fnv1a(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Normalise a string for content-addressing: trim, collapse whitespace, lower. */
export function normaliseForHash(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function chunkHash(parts: ReadonlyArray<string>): string {
  return `ch_${fnv1a(parts.map(normaliseForHash).join("|"))}`;
}

export function faqHash(question: string): string {
  return `faq_${fnv1a(normaliseForHash(question))}`;
}

export function documentHash(chunkIds: ReadonlyArray<string>): string {
  return `doc_${fnv1a(chunkIds.join("|"))}`;
}
