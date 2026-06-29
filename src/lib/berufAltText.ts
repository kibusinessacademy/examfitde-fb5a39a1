/**
 * SSOT für den Berufsbild-Alt-Text. Stellt sicher, dass JEDER Slug einen
 * sinnvollen, deutschen Alt-Text bekommt — auch wenn weder Cache-Eintrag
 * noch Scene-Metadaten vorhanden sind.
 *
 * Reihenfolge (höchste → niedrigste Priorität):
 *  1. expliziter, nicht-leerer `alt_text` aus dem Cache
 *  2. Berufstitel-basiertes Fallback ("Berufsbild für <Titel> …")
 *  3. generischer Fallback ("Authentisches deutsches Berufsbild")
 *
 * Die Funktion ist **pure** und ohne Seiteneffekte — sie wird sowohl im Hook
 * `useBerufImages` als auch in `BerufeBildAltAudit`-Tests genutzt.
 */
export function resolveBerufAltText(opts: {
  altText?: string | null;
  title?: string | null;
  kammer?: string | null;
}): string {
  const alt = (opts.altText ?? '').trim();
  if (alt.length > 0) return alt;
  const title = (opts.title ?? '').trim();
  if (title.length > 0) {
    const k = opts.kammer ? ` (${opts.kammer})` : '';
    return `Berufsbild für ${title}${k} – Auszubildende im realistischen Arbeitsumfeld.`;
  }
  return 'Authentisches deutsches Berufsbild mit Auszubildender und Mentor.';
}

/**
 * Qualitäts-Audit: erkennt Cache-Zeilen, deren Alt-Text fehlt, leer oder
 * verdächtig kurz ist. Liefert pro Slug einen normalisierten Bericht plus
 * den effektiven (Fallback-)Alt-Text, damit Konsumenten niemals ein
 * leeres `<img alt>` rendern.
 */
export type BerufAltAuditRow = {
  slug: string;
  title?: string | null;
  kammer?: string | null;
  altText?: string | null;
};
export type BerufAltAuditFinding = {
  slug: string;
  ok: boolean;
  reason?: 'missing' | 'too_short';
  effectiveAlt: string;
};

export function auditBerufAltTexts(rows: BerufAltAuditRow[]): BerufAltAuditFinding[] {
  return rows.map((r) => {
    const provided = (r.altText ?? '').trim();
    const effectiveAlt = resolveBerufAltText({
      altText: r.altText,
      title: r.title,
      kammer: r.kammer,
    });
    if (!provided) return { slug: r.slug, ok: false, reason: 'missing', effectiveAlt };
    if (provided.length < 20) return { slug: r.slug, ok: false, reason: 'too_short', effectiveAlt };
    return { slug: r.slug, ok: true, effectiveAlt };
  });
}
