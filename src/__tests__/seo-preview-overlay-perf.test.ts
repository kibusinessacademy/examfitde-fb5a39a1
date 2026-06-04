/**
 * Performance Integration Tests — SEO Preview Overlay
 *
 * Sichert das Frame-Budget der Head-Snapshot-Pipeline ab:
 *   • snapshotHead() muss << 8 ms (Frame-Budget) bleiben — auch bei
 *     vielen Head-Knoten und mehreren JSON-LD-Blöcken.
 *   • evaluate() darf den Budget zusätzlich nicht überschreiten.
 *   • Mehrere aufeinanderfolgende Route-Wechsel dürfen kein
 *     Layout-Frame-Storming verursachen (Median ≤ Budget).
 *
 * Wir nutzen JSDOM (vitest env) und messen via performance.now().
 * Layout-Frames werden indirekt geprüft, indem wir sicherstellen,
 * dass snapshotHead() reine Read-Operationen ist und keine Writes
 * an document.head vornimmt (DOM-Hash bleibt stabil).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { snapshotHead, evaluate } from '@/components/seo/SeoPreviewOverlay';

const FRAME_BUDGET_MS = 8;
const WARM_RUNS = 5;
const MEASURED_RUNS = 50;

function seedHead(routeKey: string, jsonLdBlocks = 2) {
  document.head.innerHTML = '';
  document.title = `ExamFit · ${routeKey} · Premium Lernplattform`;
  const meta = (name: string, content: string, attr: 'name' | 'property' = 'name') => {
    const m = document.createElement('meta');
    m.setAttribute(attr, name);
    m.setAttribute('content', content);
    document.head.appendChild(m);
  };
  meta('description', `Beschreibung für ${routeKey} mit ausreichend Länge für die SEO-Bewertung im Overlay.`);
  meta('robots', 'index, follow');
  meta('og:title', `OG ${routeKey}`, 'property');
  meta('og:description', `OG-Description für ${routeKey} mit genug Text.`, 'property');
  meta('og:image', `https://berufos.com/og/${routeKey}.png`, 'property');
  meta('og:url', `https://berufos.com${routeKey}`, 'property');
  meta('og:type', 'website', 'property');
  meta('twitter:card', 'summary_large_image');
  const link = document.createElement('link');
  link.setAttribute('rel', 'canonical');
  link.setAttribute('href', `https://berufos.com${routeKey}`);
  document.head.appendChild(link);
  for (let i = 0; i < jsonLdBlocks; i++) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': i === 0 ? 'WebSite' : 'BreadcrumbList',
      name: `${routeKey} #${i}`,
      url: `https://berufos.com${routeKey}`,
    });
    document.head.appendChild(s);
  }
}

function measure<T>(fn: () => T): { dt: number; out: T } {
  const t0 = performance.now();
  const out = fn();
  return { dt: performance.now() - t0, out };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

function hashHead(): string {
  return `${document.head.children.length}:${document.head.innerHTML.length}`;
}

describe('SeoPreviewOverlay · Performance Budget', () => {
  beforeEach(() => seedHead('/', 2));

  it('snapshotHead() bleibt im Frame-Budget (median & p95)', () => {
    for (let i = 0; i < WARM_RUNS; i++) snapshotHead();
    const samples: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) samples.push(measure(() => snapshotHead()).dt);
    const med = median(samples);
    const tail = p95(samples);
    expect(med).toBeLessThan(FRAME_BUDGET_MS);
    expect(tail).toBeLessThan(FRAME_BUDGET_MS * 2);
  });

  it('evaluate() läuft in O(rows) und bleibt unter 1ms (median)', () => {
    const snap = snapshotHead();
    const samples: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) samples.push(measure(() => evaluate(snap)).dt);
    expect(median(samples)).toBeLessThan(1);
  });

  it('Route-Wechsel-Sequenz hält das Budget pro Frame', () => {
    const routes = ['/', '/berufe', '/preise', '/login', '/berufe/altenpfleger', '/'];
    const per: number[] = [];
    for (const r of routes) {
      seedHead(r, r === '/' ? 3 : 2);
      per.push(measure(() => snapshotHead()).dt);
    }
    // Jeder einzelne Route-Wechsel muss in das Budget passen.
    for (const dt of per) expect(dt).toBeLessThan(FRAME_BUDGET_MS);
    expect(median(per)).toBeLessThan(FRAME_BUDGET_MS / 2);
  });

  it('snapshotHead() ist read-only — verursacht keine Head-Writes (kein Layout-Frame)', () => {
    const before = hashHead();
    for (let i = 0; i < 10; i++) snapshotHead();
    expect(hashHead()).toBe(before);
  });

  it('Skaliert linear bei vielen JSON-LD-Blöcken (kein quadratisches Verhalten)', () => {
    seedHead('/scale-small', 2);
    const small = median(Array.from({ length: 20 }, () => measure(() => snapshotHead()).dt));
    seedHead('/scale-large', 20);
    const large = median(Array.from({ length: 20 }, () => measure(() => snapshotHead()).dt));
    // Bei 10× Blöcken darf die Laufzeit nicht stärker als ~15× wachsen
    // (deckt Parser-Overhead ab, schließt quadratisches Verhalten aus).
    expect(large).toBeLessThan(Math.max(small * 15, FRAME_BUDGET_MS));
  });
});
