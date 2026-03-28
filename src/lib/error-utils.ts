/**
 * Convert any error value to a human-readable string.
 * Prevents "[object Object]" from ever reaching the UI.
 */
export function getReadableErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;

  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.error_description === 'string') return obj.error_description;
    if (typeof obj.msg === 'string') return obj.msg;
    try {
      const json = JSON.stringify(err);
      if (json !== '{}') return json;
    } catch { /* ignore */ }
  }

  return 'Ein unbekannter Fehler ist aufgetreten.';
}
