/**
 * Shared per-phase tracker for E2E specs.
 *
 * - Logs each phase transition with attempt number + suite tag.
 * - On failure, attaches: phase summary, full screenshot, network HAR-lite
 *   (recent requests captured by the caller), and last RPC bodies.
 * - Persists a tiny JSON breadcrumb to test-results/phase-breadcrumbs/
 *   so the post-run summary script can read the last seen phase per spec.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

const BREADCRUMB_DIR = path.resolve("test-results/phase-breadcrumbs");

export type PhaseTracker = {
  set: (name: string) => void;
  current: () => string;
  recordRpc: (label: string, status: number, bodySnippet: string) => void;
  attachFailure: (err: unknown) => Promise<void>;
};

export function createPhaseTracker(opts: {
  suite: string;
  page: Page;
  testInfo: TestInfo;
}): PhaseTracker {
  const { suite, page, testInfo } = opts;
  const attempt = testInfo.retry;
  let currentPhase = "init";
  const phaseHistory: string[] = [];
  const rpcLog: Array<{ phase: string; label: string; status: number; body: string; ts: string }> = [];

  const writeBreadcrumb = () => {
    try {
      fs.mkdirSync(BREADCRUMB_DIR, { recursive: true });
      const file = path.join(BREADCRUMB_DIR, `${suite}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            suite,
            attempt,
            currentPhase,
            phaseHistory,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch {
      // breadcrumb is best-effort
    }
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[${suite}][attempt=${attempt}][phase=${currentPhase}] console.error: ${msg.text()}`);
    }
  });
  page.on("requestfailed", (req) => {
    console.log(
      `[${suite}][attempt=${attempt}][phase=${currentPhase}] requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`,
    );
  });

  return {
    set(name: string) {
      currentPhase = name;
      phaseHistory.push(name);
      console.log(`[${suite}][attempt=${attempt}] ▶ phase: ${name}`);
      writeBreadcrumb();
    },
    current() {
      return currentPhase;
    },
    recordRpc(label, status, body) {
      const snippet = (body || "").slice(0, 500);
      rpcLog.push({ phase: currentPhase, label, status, body: snippet, ts: new Date().toISOString() });
      console.log(`[${suite}][attempt=${attempt}][phase=${currentPhase}] rpc ${label} → ${status} body=${snippet}`);
    },
    async attachFailure(err) {
      const message = (err as Error)?.message ?? String(err);
      console.log(`[${suite}][attempt=${attempt}] ✖ FAIL in phase=${currentPhase}: ${message}`);
      const summary = {
        suite,
        attempt,
        currentPhase,
        phaseHistory,
        url: page.url(),
        error: message,
        rpcLog,
      };
      try {
        await testInfo.attach(`${suite}-fail-summary.json`, {
          body: Buffer.from(JSON.stringify(summary, null, 2)),
          contentType: "application/json",
        });
      } catch {}
      try {
        const png = await page.screenshot({ fullPage: true });
        await testInfo.attach(`${suite}-fail-${currentPhase}.png`, {
          body: png,
          contentType: "image/png",
        });
      } catch {}
      writeBreadcrumb();
    },
  };
}
