import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../scripts/ops/auto-heal-log-migrate.mjs");

function runMigrate(input: unknown, args: string[] = []): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync("node", [SCRIPT, ...args], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

describe("auto-heal-log-migrate --sql mode", () => {
  it("emits BEGIN/COMMIT transaction wrapper", () => {
    const { stdout, status } = runMigrate(
      [{ action_type: "test", target_type: "system", result_status: "ok", trigger_source: "unit" }],
      ["--sql"],
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/^-- auto_heal_log canonical migration \(INSERT\)/m);
    expect(stdout).toContain("BEGIN;");
    expect(stdout).toContain("COMMIT;");
    expect(stdout).toContain("INSERT INTO public.auto_heal_log");
  });

  it("serializes JSONB metadata with ::jsonb cast and escapes single quotes", () => {
    const { stdout } = runMigrate(
      [{ action_type: "x", metadata: { msg: "it's fine", n: 1, arr: [1, 2] } }],
      ["--sql"],
    );
    // JSON-stringified, single quotes doubled, jsonb cast
    expect(stdout).toMatch(/'\{"msg":"it''s fine","n":1,"arr":\[1,2\]\}'::jsonb/);
  });

  it("escapes single quotes in text fields (SQL injection safety)", () => {
    const { stdout } = runMigrate(
      [{ action_type: "drop'; --", trigger_source: "a'b", target_type: "system" }],
      ["--sql"],
    );
    expect(stdout).toContain("'drop''; --'");
    expect(stdout).toContain("'a''b'");
  });

  it("renders UUID target_id as quoted text literal (Postgres casts to uuid)", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const { stdout } = runMigrate(
      [{ action_type: "x", target_type: "package", target_id: uuid }],
      ["--sql"],
    );
    expect(stdout).toContain(`'${uuid}'`);
  });

  it("maps legacy package_id → target_id + target_type='package' in SQL output", () => {
    const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const { stdout } = runMigrate(
      [{ action: "legacy_act", package_id: uuid, details: { foo: "bar" }, triggered_by: "cron" }],
      ["--sql"],
    );
    expect(stdout).toContain("action_type");
    expect(stdout).toContain("'legacy_act'");
    expect(stdout).toContain(`'${uuid}'`);
    expect(stdout).toContain("'package'");
    expect(stdout).toContain('{"foo":"bar"}\'::jsonb'.replace("\\'", "'"));
    expect(stdout).toContain("'cron'");
  });

  it("defaults missing metadata to '{}'::jsonb", () => {
    const { stdout } = runMigrate([{ action_type: "x" }], ["--sql"]);
    expect(stdout).toContain("'{}'::jsonb");
  });

  it("UPDATE mode emits UPDATE ... WHERE id = '...'", () => {
    const { stdout } = runMigrate(
      [{ id: "row-1", action_type: "u", metadata: { k: 1 } }],
      ["--sql=update"],
    );
    expect(stdout).toContain("UPDATE public.auto_heal_log SET");
    expect(stdout).toContain("WHERE id = 'row-1'");
    expect(stdout).toContain("'{\"k\":1}'::jsonb");
  });

  it("UPDATE mode skips rows missing the id column with a comment", () => {
    const { stdout } = runMigrate(
      [{ action_type: "u" }],
      ["--sql=update"],
    );
    expect(stdout).toContain("-- SKIP: missing id for UPDATE");
  });

  it("UPDATE mode honors --id=<col> for custom primary keys", () => {
    const { stdout } = runMigrate(
      [{ log_uid: "abc", action_type: "u" }],
      ["--sql=update", "--id=log_uid"],
    );
    expect(stdout).toContain("WHERE log_uid = 'abc'");
  });

  it("handles multiple rows in a single transaction", () => {
    const { stdout } = runMigrate(
      [
        { action_type: "a" },
        { action_type: "b" },
        { action_type: "c" },
      ],
      ["--sql"],
    );
    const inserts = stdout.match(/INSERT INTO public\.auto_heal_log/g) || [];
    expect(inserts.length).toBe(3);
    expect(stdout.indexOf("BEGIN;")).toBeLessThan(stdout.indexOf("INSERT"));
    expect(stdout.lastIndexOf("INSERT")).toBeLessThan(stdout.indexOf("COMMIT;"));
  });
});
