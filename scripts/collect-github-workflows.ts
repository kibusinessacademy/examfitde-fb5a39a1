#!/usr/bin/env bun
/**
 * Collect GitHub workflow metadata and upsert into `github_workflow_registry`.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/collect-github-workflows.ts
 *   (locally — used by CI or ops to refresh the registry)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
// @ts-expect-error - js-yaml is widely available; install if needed
import yaml from 'js-yaml';

const WF_DIR = '.github/workflows';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function clusterOf(name: string): string | null {
  const base = name.replace(/\.ya?ml$/, '');
  const m = base.match(/^([a-z0-9]+)-/i);
  return m ? m[1].toLowerCase() : null;
}

function extractTriggers(on: any): string[] {
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === 'object') return Object.keys(on);
  return [];
}

function extractSchedules(on: any): string[] {
  if (!on || typeof on !== 'object' || !on.schedule) return [];
  const sched = Array.isArray(on.schedule) ? on.schedule : [on.schedule];
  return sched.map((s: any) => s.cron).filter(Boolean);
}

async function main() {
  const files = (await readdir(WF_DIR)).filter(f => /\.ya?ml$/.test(f));
  console.log(`Found ${files.length} workflow files`);

  const rows: any[] = [];
  for (const file of files) {
    const path = join(WF_DIR, file);
    const buf = await readFile(path);
    const text = buf.toString('utf8');
    const st = await stat(path);
    const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);

    let parsed: any = {};
    try { parsed = yaml.load(text) ?? {}; } catch (e) { console.warn(`yaml parse failed ${file}: ${(e as Error).message}`); }

    const triggers = extractTriggers(parsed.on);
    const schedules = extractSchedules(parsed.on);
    const jobs = parsed.jobs ? Object.keys(parsed.jobs) : [];

    rows.push({
      name: file,
      file_path: path,
      display_name: parsed.name ?? file,
      triggers,
      jobs,
      schedule_cron: schedules.length ? schedules : null,
      permissions: parsed.permissions ?? null,
      file_bytes: st.size,
      loc: text.split('\n').length,
      sha,
      cluster: clusterOf(file),
      is_active: true,
      last_synced_at: new Date().toISOString(),
      metadata: { defaults: parsed.defaults ?? null, env_keys: parsed.env ? Object.keys(parsed.env) : [] },
    });
  }

  // Chunked upsert
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase.from('github_workflow_registry').upsert(chunk, { onConflict: 'name' });
    if (error) { console.error('upsert error', error); process.exit(1); }
  }

  // Deactivate stale entries (files removed from repo)
  const names = rows.map(r => r.name);
  const { data: existing } = await supabase.from('github_workflow_registry').select('name');
  const stale = (existing ?? []).map((r: any) => r.name).filter((n: string) => !names.includes(n));
  if (stale.length) {
    await supabase.from('github_workflow_registry').update({ is_active: false }).in('name', stale);
    console.log(`Marked ${stale.length} workflows as inactive`);
  }

  console.log(`Upserted ${rows.length} workflows`);
}

main().catch(e => { console.error(e); process.exit(1); });
