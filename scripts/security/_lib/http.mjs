/**
 * Minimal HTTP helpers for security test scripts.
 */

export async function jfetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { res, text, json };
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
