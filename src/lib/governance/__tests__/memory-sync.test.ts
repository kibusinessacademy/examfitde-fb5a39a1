import { describe, it, expect } from 'vitest';
import { extractMemoryReferences, syncMemoryAgainstRegistry } from '../memory-sync';

describe('memory-sync v1.2', () => {
  it('extrahiert snake_case-System-Refs aus Keyword-Zeilen', () => {
    const text = [
      '## Core',
      'SSOT für Funnel: `conversion_events` mit 6 Pflicht-Events.',
      'Email-Sequenzen via email_delivery_queue + email-sequence-worker.',
      'Random irrelevant prose ohne keywords.',
    ].join('\n');
    const refs = extractMemoryReferences(text);
    expect(refs).toContain('conversion_events');
    expect(refs).toContain('email_delivery_queue');
  });

  it('bekannte Systeme bestehen den Sync', () => {
    const text = 'SSOT auto_heal_log + ops_audit_contract registry queue job_queue.';
    const r = syncMemoryAgainstRegistry(text, []);
    expect(r.missing).toEqual([]);
    expect(r.covered).toEqual(expect.arrayContaining(['auto_heal_log', 'job_queue']));
  });

  it('Memory-SSOT ohne known-system-Eintrag wird als missing markiert', () => {
    const text = 'Neuer SSOT: `phantom_outbox_queue` + zugehöriger phantom_audit_log.';
    const r = syncMemoryAgainstRegistry(text, []);
    expect(r.missing).toEqual(expect.arrayContaining(['phantom_outbox_queue', 'phantom_audit_log']));
  });

  it('Allowlist verschiebt missing → allowed', () => {
    const text = 'Neuer SSOT: `phantom_outbox_queue`.';
    const r = syncMemoryAgainstRegistry(text, ['phantom_outbox_queue']);
    expect(r.missing).not.toContain('phantom_outbox_queue');
    expect(r.allowed).toContain('phantom_outbox_queue');
  });

  it('Ausgabe ist deterministisch', () => {
    const text = 'queue x_event_log und audit foo_registry.';
    const a = JSON.stringify(syncMemoryAgainstRegistry(text, []));
    const b = JSON.stringify(syncMemoryAgainstRegistry(text, []));
    expect(a).toBe(b);
  });
});
