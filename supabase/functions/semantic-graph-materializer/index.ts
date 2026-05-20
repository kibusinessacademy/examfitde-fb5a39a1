/**
 * P5/P6 — Semantic Knowledge Graph Materializer.
 *
 * Pulls deterministic SSOT sources (certifications → beruf,
 * learning_fields → lernfeld, competencies → kompetenz) and writes
 * a new immutable snapshot into semantic_graph_*. Publishes atomically
 * via semantic_graph_publish_snapshot(snapshot_id).
 *
 * Idempotent: skips publish if source_hash matches the currently
 * published snapshot. Service-role only.
 *
 * P6: Writes a row into `semantic_graph_materialization_runs` for every
 * invocation (started → published | skipped_unchanged | failed). The
 * row carries entity/edge/orphan/route counts and PII-free error codes.
 * Never leaves a half-published snapshot behind.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Entity = { entity_id: string; kind: string; key: string; name: string; description?: string | null; meta?: Record<string, unknown> };
type Edge = { from_id: string; to_id: string; kind: string; weight?: number | null };

const ROUTED_KINDS = new Set(["beruf", "kompetenz", "pruefung"]);

function slug(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function fnv1a(input: string): Promise<string> {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

async function loadSources() {
  const { data: certs, error: e1 } = await supabase
    .from("certifications")
    .select("id,title,slug,provider")
    .eq("active", true)
    .limit(2000);
  if (e1) throw new Error(`LOAD_CERTIFICATIONS:${e1.code ?? "err"}`);

  const { data: curricula, error: e2 } = await supabase
    .from("curricula")
    .select("id,certification_id")
    .limit(2000);
  if (e2) throw new Error(`LOAD_CURRICULA:${e2.code ?? "err"}`);

  const { data: lfs, error: e3 } = await supabase
    .from("learning_fields")
    .select("id,curriculum_id,code,title,sort_order")
    .limit(20000);
  if (e3) throw new Error(`LOAD_LEARNING_FIELDS:${e3.code ?? "err"}`);

  const { data: comps, error: e4 } = await supabase
    .from("competencies")
    .select("id,learning_field_id,code,title")
    .limit(60000);
  if (e4) throw new Error(`LOAD_COMPETENCIES:${e4.code ?? "err"}`);

  return { certs: certs ?? [], curricula: curricula ?? [], lfs: lfs ?? [], comps: comps ?? [] };
}

// deno-lint-ignore no-explicit-any
function build(certs: any[], curricula: any[], lfs: any[], comps: any[]): { entities: Entity[]; edges: Edge[] } {
  const entities: Entity[] = [];
  const edges: Edge[] = [];

  const certEntityId = new Map<string, string>();
  for (const c of certs) {
    if (!c.id) continue;
    const key = c.slug ? slug(c.slug) : slug(c.title ?? c.id);
    if (!key) continue;
    const eid = `beruf:${c.id}`;
    certEntityId.set(c.id, eid);
    entities.push({
      entity_id: eid,
      kind: "beruf",
      key,
      name: c.title ?? key,
      meta: { certification_id: c.id, provider: c.provider ?? null },
    });
  }

  const currCertEntity = new Map<string, string>();
  for (const cu of curricula) {
    if (!cu.id || !cu.certification_id) continue;
    const beruf = certEntityId.get(cu.certification_id);
    if (beruf) currCertEntity.set(cu.id, beruf);
  }

  const lfEntityId = new Map<string, string>();
  for (const lf of lfs) {
    const beruf = currCertEntity.get(lf.curriculum_id);
    if (!beruf || !lf.id) continue;
    const code = lf.code ? slug(lf.code) : "lf";
    const eid = `lernfeld:${lf.id}`;
    const key = `${beruf.replace("beruf:", "")}--${code}`;
    lfEntityId.set(lf.id, eid);
    entities.push({
      entity_id: eid,
      kind: "lernfeld",
      key,
      name: lf.title ?? code,
      meta: { code: lf.code ?? null, ordinal: lf.sort_order ?? null },
    });
    edges.push({ from_id: beruf, to_id: eid, kind: "beruf_has_lernfeld" });
  }

  for (const k of comps) {
    const lfId = lfEntityId.get(k.learning_field_id);
    if (!lfId || !k.id) continue;
    const code = k.code ? slug(k.code) : "k";
    const eid = `kompetenz:${k.id}`;
    const key = `${lfId.replace("lernfeld:", "")}--${code}`;
    entities.push({
      entity_id: eid,
      kind: "kompetenz",
      key,
      name: k.title ?? code,
      meta: { code: k.code ?? null },
    });
    edges.push({ from_id: lfId, to_id: eid, kind: "lernfeld_has_kompetenz" });
  }

  const touched = new Set<string>();
  for (const x of edges) { touched.add(x.from_id); touched.add(x.to_id); }
  const cleanEntities = entities.filter((e) => touched.has(e.entity_id));

  cleanEntities.sort((a, b) => (a.kind + a.key + a.entity_id).localeCompare(b.kind + b.key + b.entity_id));
  edges.sort((a, b) => (a.kind + a.from_id + a.to_id).localeCompare(b.kind + b.from_id + b.to_id));

  return { entities: cleanEntities, edges };
}

async function chunkInsert<T>(table: string, snapshot_id: string, rows: T[]): Promise<void> {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({ ...r, snapshot_id }));
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw new Error(`INSERT_${table.toUpperCase()}:${error.code ?? "err"}`);
  }
}

interface RunCtx {
  run_id: string | null;
  source_hash: string;
  entities: number;
  edges: number;
  routes: number;
  sitemap_routes: number;
}

async function startRun(source_hash: string, entities: number, edges: number, routes: number): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("semantic_graph_materialization_runs")
      .insert({
        source_hash,
        status: "started",
        entity_count: entities,
        edge_count: edges,
        route_count: routes,
        sitemap_route_count: routes, // sitemap mirrors materializer route output
        metadata: { producer: "semantic-graph-materializer" },
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

async function finishRun(
  run_id: string | null,
  patch: {
    status: "skipped_unchanged" | "published" | "failed";
    snapshot_id?: string | null;
    orphan_count?: number;
    error_code?: string | null;
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!run_id) return;
  try {
    await supabase
      .from("semantic_graph_materialization_runs")
      .update({
        status: patch.status,
        snapshot_id: patch.snapshot_id ?? null,
        orphan_count: patch.orphan_count ?? 0,
        finished_at: new Date().toISOString(),
        error_code: patch.error_code ?? null,
        error_message: patch.error_message ?? null,
        metadata: patch.metadata ?? {},
      })
      .eq("id", run_id);
  } catch { /* never block */ }
}

function piiSafeMessage(err: unknown): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  // Strip everything past 240 chars and any obvious row/email patterns.
  const message = raw.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted]").slice(0, 240);
  const m = raw.match(/^([A-Z_]+:[a-zA-Z0-9_]+)/);
  return { code: m?.[1] ?? "MATERIALIZER_INTERNAL", message };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let run_id: string | null = null;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const force = !!body?.force;

    const { certs, curricula, lfs, comps } = await loadSources();
    const { entities, edges } = build(certs, curricula, lfs, comps);

    const routes = entities.filter((e) => ROUTED_KINDS.has(e.kind)).length;
    const hashInput = JSON.stringify({ entities, edges });
    const source_hash = await fnv1a(hashInput);

    run_id = await startRun(source_hash, entities.length, edges.length, routes);

    // Skip if already published with same hash.
    const { data: cur } = await supabase
      .from("semantic_graph_snapshots")
      .select("id,source_hash,snapshot_at,entity_count,edge_count")
      .eq("status", "published")
      .order("snapshot_at", { ascending: false })
      .limit(1);

    if (!force && cur?.[0]?.source_hash === source_hash) {
      await finishRun(run_id, {
        status: "skipped_unchanged",
        snapshot_id: cur[0].id,
        metadata: { reason: "source_hash_unchanged" },
      });
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "source_hash_unchanged", snapshot_id: cur[0].id, hash: source_hash, entities: entities.length, edges: edges.length, run_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: snap, error: snapErr } = await supabase
      .from("semantic_graph_snapshots")
      .insert({ source_hash, entity_count: entities.length, edge_count: edges.length, status: "draft", meta: { source: "materializer", run_id } })
      .select("id")
      .single();
    if (snapErr || !snap) throw new Error(`SNAPSHOT_INSERT:${snapErr?.code ?? "nil"}`);

    try {
      await chunkInsert("semantic_graph_entities", snap.id, entities);
      await chunkInsert("semantic_graph_edges", snap.id, edges);
      const { error: pubErr } = await supabase.rpc("semantic_graph_publish_snapshot", { _snapshot_id: snap.id });
      if (pubErr) throw new Error(`PUBLISH_RPC:${pubErr.code ?? "err"}`);
    } catch (inner) {
      // Atomic guard: drop the draft snapshot rather than leave a half-published one.
      try { await supabase.from("semantic_graph_snapshots").delete().eq("id", snap.id).eq("status", "draft"); } catch { /* */ }
      throw inner;
    }

    // Orphan count of newly published graph (should be 0 by construction).
    const { count: orphan_count } = await supabase
      .from("v_semantic_graph_orphans")
      .select("*", { count: "exact", head: true });

    await finishRun(run_id, {
      status: "published",
      snapshot_id: snap.id,
      orphan_count: orphan_count ?? 0,
      metadata: { reason: "published" },
    });

    return new Response(
      JSON.stringify({ ok: true, published: true, snapshot_id: snap.id, hash: source_hash, entities: entities.length, edges: edges.length, routes, run_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const { code, message } = piiSafeMessage(err);
    await finishRun(run_id, { status: "failed", error_code: code, error_message: message });
    return new Response(
      JSON.stringify({ ok: false, error_code: code, error: message, run_id }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
