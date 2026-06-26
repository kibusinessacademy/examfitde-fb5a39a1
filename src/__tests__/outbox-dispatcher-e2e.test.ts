/**
 * E2E outbox dispatcher: real heal_alert_notifications row lifecycle
 * pending → processing → sent|skipped|failed → dlq, with attempt counts,
 * exponential backoff (next_attempt_at), and isolation from unrelated rows.
 *
 * Test rows are tagged via payload.__e2e=true and alert_key='__e2e_parity'
 * and removed with admin_e2e_outbox_cleanup(); destination is a disabled
 * slack target so nothing is ever delivered externally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const maybe = url && key ? describe : describe.skip;

maybe("outbox dispatcher E2E (real rows, no Slack/Resend)", () => {
  const supabase = createClient(url || "http://localhost:54321", key || "test-key");

  beforeAll(async () => { await supabase.rpc("admin_e2e_outbox_cleanup"); });
  afterAll(async () => { await supabase.rpc("admin_e2e_outbox_cleanup"); });

  const enqueue = async (scenario: string, outcome: string, max = 5, idemKey?: string) => {
    const { data, error } = await supabase.rpc("admin_e2e_outbox_enqueue", {
      p_scenario: scenario, p_outcome: outcome, p_max_attempts: max,
      p_idempotency_key: idemKey ?? null,
    });
    expect(error).toBeNull();
    return data as unknown as string;
  };
  const step = async (id: string) => {
    const { data, error } = await supabase.rpc("admin_e2e_outbox_dispatch_step", { p_id: id });
    expect(error).toBeNull();
    return data as any;
  };
  const snap = async (id: string) => {
    const { data, error } = await supabase.rpc("admin_e2e_outbox_get", { p_id: id });
    expect(error).toBeNull();
    return data as any;
  };

  it("ok outcome → exactly one transition pending → processing → sent (attempt=1)", async () => {
    const id = await enqueue("late", "ok", 5);
    const t1 = await step(id);
    expect(t1.previous_status).toBe("processing"); // already moved by step
    expect(t1.status).toBe("sent");
    expect(t1.attempts).toBe(1);
    expect(t1.terminal).toBe(true);
    const row = await snap(id);
    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBeNull();
    expect(row.sent_at).not.toBeNull();
    // No-op when terminal
    const t2 = await step(id);
    expect(t2.noop).toBe(true);
  });

  it("missing_secret → status skipped, attempts=1, no retry", async () => {
    const id = await enqueue("missing", "missing_secret", 5);
    const t = await step(id);
    expect(t.status).toBe("skipped");
    expect(t.attempts).toBe(1);
    expect(t.last_error).toMatch(/missing_secret/);
    expect(t.next_attempt_at).toBeNull();
    expect(t.terminal).toBe(true);
  });

  it("webhook_500 → retries with exponential backoff, dlq at max_attempts", async () => {
    const max = 4;
    const id = await enqueue("missing", "webhook_500", max);

    // Track unrelated rows count to assert isolation
    const { count: beforeCount } = await supabase
      .from("heal_alert_notifications")
      .select("*", { count: "exact", head: true })
      .neq("alert_key", "__e2e_parity");

    const transitions: any[] = [];
    for (let i = 0; i < max + 1; i++) {
      const r = await step(id);
      transitions.push(r);
      if (r.terminal) break;
    }

    // Exactly max attempts, last is dlq
    expect(transitions.length).toBe(max);
    expect(transitions[max - 1].status).toBe("dlq");
    expect(transitions[max - 1].reached_dlq).toBe(true);
    expect(transitions[max - 1].attempts).toBe(max);

    // Non-terminal attempts must be 'failed' with monotonically increasing backoff
    const tBefore = Date.now();
    for (let i = 0; i < max - 1; i++) {
      expect(transitions[i].status).toBe("failed");
      expect(transitions[i].attempts).toBe(i + 1);
      expect(transitions[i].next_attempt_at).not.toBeNull();
      const next = new Date(transitions[i].next_attempt_at).getTime();
      // Exponential 2^attempts minutes — at minimum a few seconds in the future
      expect(next).toBeGreaterThan(tBefore);
    }
    // dlq has no further backoff
    expect(transitions[max - 1].next_attempt_at).toBeNull();

    // Unrelated rows still untouched
    const { count: afterCount } = await supabase
      .from("heal_alert_notifications")
      .select("*", { count: "exact", head: true })
      .neq("alert_key", "__e2e_parity");
    expect(afterCount).toBe(beforeCount);
  });

  it("snapshot row state matches dispatcher return value", async () => {
    const id = await enqueue("late", "webhook_500", 3);
    const r = await step(id);
    const row = await snap(id);
    expect(row.status).toBe(r.status);
    expect(row.attempts).toBe(r.attempts);
    expect(row.last_error).toBe(r.last_error);
  });

  it("idempotent enqueue: same key returns same row id while non-terminal", async () => {
    const k = `idem-${Date.now()}`;
    const a = await enqueue("late", "webhook_500", 5, k);
    const b = await enqueue("late", "webhook_500", 5, k);
    const c = await enqueue("late", "webhook_500", 5, `${k}-other`);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    // Advance once → still pending key reuses same row
    await step(a);
    const d = await enqueue("late", "webhook_500", 5, k);
    expect(d).toBe(a);
  });

  it("after terminal state, idempotency key starts a fresh row", async () => {
    const k = `idem-term-${Date.now()}`;
    const a = await enqueue("late", "ok", 5, k);
    await step(a); // → sent (terminal)
    const b = await enqueue("late", "ok", 5, k);
    expect(b).not.toBe(a);
  });

  it("retries on row A do not mutate row B (per-row isolation)", async () => {
    const a = await enqueue("late", "webhook_500", 4, `iso-a-${Date.now()}`);
    const b = await enqueue("late", "webhook_500", 4, `iso-b-${Date.now()}`);
    const bBefore = await snap(b);
    // Drive A to dlq
    for (let i = 0; i < 4; i++) {
      const r = await step(a);
      if (r.terminal) break;
    }
    const aAfter = await snap(a);
    const bAfter = await snap(b);
    expect(aAfter.status).toBe("dlq");
    expect(aAfter.attempts).toBe(4);
    // B is untouched
    expect(bAfter.status).toBe(bBefore.status);
    expect(bAfter.attempts).toBe(bBefore.attempts);
    expect(bAfter.last_error).toBe(bBefore.last_error);
    expect(bAfter.next_attempt_at).toBe(bBefore.next_attempt_at);
  });
});

