/**
 * Minimal assertion helpers for security test scripts.
 */

export function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function warn(cond, msg) {
  if (!cond) console.warn("⚠️", msg);
}
