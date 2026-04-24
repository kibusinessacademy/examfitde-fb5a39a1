/**
 * findingClassifier
 * ─────────────────
 * Auto-Klassifiziert Linter-/Scanner-Findings in P0–P3 anhand verbreiteter
 * Signal-Heuristiken (Grant-Matrix, Tabellen-Sensitivität, RLS-Status).
 *
 * Quellen:
 *   - Supabase Database Linter (`SUPA_*` IDs)
 *   - Lovable Agent Security Scanner (`agent_security`)
 *   - Lovable Sicherheits-Scanner v2 (`supabase_lov`)
 *
 * Output: stabile Priority + Score + empfohlene Folge-Prüfungen.
 */

export type FindingPriority = "P0" | "P1" | "P2" | "P3";

export interface RawFinding {
  id?: string;
  internal_id?: string;
  scanner_name?: string;
  name?: string;
  description?: string;
  details?: string;
  level?: "info" | "warn" | "error" | string;
  link?: string;
  ignore?: boolean;
  ignore_reason?: string;
}

export interface ClassifiedFinding extends RawFinding {
  priority: FindingPriority;
  score: number;
  reasoning: string[];
  signals: {
    anonGranted: boolean;
    authGranted: boolean;
    serviceOnly: boolean;
    sensitiveData: boolean;
    rlsMissing: boolean;
    publicWrite: boolean;
  };
  recommendedChecks: string[];
}

const SENSITIVE_PATTERNS = [
  /\bauth\b/i,
  /password/i,
  /\bemail\b/i,
  /payment|invoice|subscription|order|stripe|paddle/i,
  /\bgdpr\b|consent|privacy/i,
  /api[_-]?key|secret|token|jwt/i,
  /payout|earning|revenue|finance|ledger/i,
  /personal|pii|sensitive/i,
  /exam_question|correct_answer|answer_text|distractor/i,
];

const ANON_PATTERNS = [
  /\banon\b/i,
  /unauthenticated|unauthorized\s+access/i,
  /'\{public\}'/,
  /\{public\}/,
  /publicly\s+accessible/i,
];

const AUTH_PATTERNS = [
  /authenticated\s+user/i,
  /any\s+(logged[\s-]?in|registered)/i,
  /\{authenticated\}/,
];

const PUBLIC_WRITE_PATTERNS = [
  /USING\s*\(\s*true\s*\)/i,
  /WITH\s+CHECK\s*\(\s*true\s*\)/i,
  /can\s+insert|can\s+update|can\s+delete/i,
  /unrestricted\s+(insert|update|delete|write)/i,
];

const RLS_MISSING_PATTERNS = [
  /no\s+rls\s+polic/i,
  /rls\s+disabled/i,
  /missing\s+rls/i,
  /without\s+rls/i,
];

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function classifyFinding(f: RawFinding): ClassifiedFinding {
  const haystack = [f.name, f.description, f.details, f.id, f.internal_id]
    .filter(Boolean)
    .join("  ");

  const signals = {
    anonGranted: matches(haystack, ANON_PATTERNS),
    authGranted: matches(haystack, AUTH_PATTERNS),
    serviceOnly: /service[_\s-]?role[\s-]?only|service_role/i.test(haystack) && !matches(haystack, ANON_PATTERNS),
    sensitiveData: matches(haystack, SENSITIVE_PATTERNS),
    rlsMissing: matches(haystack, RLS_MISSING_PATTERNS),
    publicWrite: matches(haystack, PUBLIC_WRITE_PATTERNS),
  };

  let score = 0;
  const reasoning: string[] = [];

  if (signals.anonGranted) {
    score += 60;
    reasoning.push("Anon/Public-Grant erkannt — direkter Public-Exposure.");
  }
  if (signals.publicWrite && (signals.anonGranted || signals.authGranted)) {
    score += 25;
    reasoning.push("Schreibender Zugriff (`USING true`/`WITH CHECK true`) für Nicht-Service-Rolle.");
  }
  if (signals.rlsMissing) {
    score += 30;
    reasoning.push("Fehlende RLS-Policies → unrestricted Zugriff möglich.");
  }
  if (signals.sensitiveData) {
    score += 20;
    reasoning.push("Tabelle enthält sensible/PII/Exam-Daten.");
  }
  if (signals.authGranted && signals.sensitiveData) {
    score += 15;
    reasoning.push("Authenticated-User-Zugriff auf sensitive Inhalte.");
  }
  if (f.level === "error") {
    score += 10;
    reasoning.push("Scanner-Severity = error.");
  }
  if (signals.serviceOnly) {
    score -= 20;
    reasoning.push("Nur Service-Role-Zugriff — kein User-Vektor.");
  }
  if (f.ignore) {
    score -= 15;
    reasoning.push("Finding wurde manuell als ignoriert/akzeptiert markiert.");
  }

  // Specific finding-id boosts
  if (/EXAM_INTEGRITY|exam_integrity/i.test(`${f.id} ${f.internal_id}`)) {
    score += 25;
    reasoning.push("Exam-Integrität betroffen — Cheating-Vektor.");
  }
  if (/REALTIME.*UNRESTRICTED|realtime.*no.?rls/i.test(`${f.id} ${f.internal_id}`)) {
    score += 20;
    reasoning.push("Realtime-Channel offen — Channel-Hijacking möglich.");
  }
  if (/SECURITY[_\s]DEFINER[_\s]VIEW|security_definer_view/i.test(`${f.id} ${f.internal_id}`)) {
    // Reduce default priority for SECDEF view findings — sie sind oft dokumentierte Ausnahmen
    score -= 25;
    reasoning.push("SECURITY DEFINER View — meist Defense-in-Depth, abhängig von Grant-Matrix.");
  }

  let priority: FindingPriority = "P3";
  if (score >= 70) priority = "P0";
  else if (score >= 40) priority = "P1";
  else if (score >= 15) priority = "P2";

  const recommendedChecks = buildChecks(f, signals, priority);

  return { ...f, priority, score, reasoning, signals, recommendedChecks };
}

function buildChecks(
  f: RawFinding,
  signals: ClassifiedFinding["signals"],
  priority: FindingPriority,
): string[] {
  const out: string[] = [];

  if (signals.anonGranted || signals.publicWrite) {
    out.push("`SELECT * FROM pg_policies WHERE roles && ARRAY['anon','public']` — alle anon-Policies prüfen.");
    out.push("`node scripts/security/anon-pentest.mjs` ausführen — Regression Gate.");
  }
  if (signals.rlsMissing) {
    out.push("`SELECT relname FROM pg_class WHERE relrowsecurity=false AND relkind='r'` — Tabellen ohne RLS.");
  }
  if (signals.sensitiveData) {
    out.push("Spalten-Audit: PII/Secrets in betroffenen Tabellen identifizieren und Mask-/Hash-Strategie prüfen.");
  }
  if (signals.authGranted && !signals.serviceOnly) {
    out.push("RLS-Policy mit Owner-Scope (`auth.uid() = user_id`) oder Entitlement-Check ergänzen.");
  }
  if (/SECURITY[_\s]DEFINER[_\s]VIEW|security_definer_view/i.test(`${f.id} ${f.internal_id}`)) {
    out.push("`role_table_grants` für betroffene Views prüfen — nur konvertieren, wenn anon/auth Grant existiert.");
    out.push("Dependency-Map konsultieren: `/mnt/documents/security/secdef-views-dependency-map.json`.");
  }
  if (priority === "P0" || priority === "P1") {
    out.push("`node scripts/security/extended-pentest.mjs` — OWASP API Top 10 Re-Run.");
    out.push("Migration mit `service_role`-only Policies erstellen, Owner-Scope für SELECT hinzufügen.");
  }
  if (priority === "P2" || priority === "P3") {
    out.push("Als dokumentierte Ausnahme im Memory aufnehmen, falls beabsichtigt.");
  }
  if (out.length === 0) {
    out.push("Keine sofortige Aktion erforderlich — Status periodisch beobachten.");
  }
  return out;
}

export function classifyAll(findings: RawFinding[]): ClassifiedFinding[] {
  return findings.map(classifyFinding).sort((a, b) => b.score - a.score);
}

export function summarize(findings: ClassifiedFinding[]) {
  const byPrio: Record<FindingPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) byPrio[f.priority]++;
  const open = findings.filter((f) => !f.ignore).length;
  const ignored = findings.filter((f) => f.ignore).length;
  return { byPrio, open, ignored, total: findings.length };
}
