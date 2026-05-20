/**
 * P5 — Semantic Knowledge Graph Materializer.
 *
 * Pulls deterministic SSOT sources (certifications → beruf,
 * learning_fields → lernfeld, competencies → kompetenz) and writes
 * a new immutable snapshot into semantic_graph_*. Publishes atomically
 * via semantic_graph_publish_snapshot(snapshot_id).
 *
 * Idempotent: skips publish if source_hash matches the currently
 * published snapshot. Service-role only.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Entity = { entity_id: string; kind: string; key: string; name: string; description?: string | null; meta?: Record<string, unknown> };
type Edge = { from_id: string; to_id: string; kind: string; weight?: number | null };

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
  // Stable content hash (FNV-1a 32-bit hex, matches P2 hash family).
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

async function loadSources() {
  // Berufe ← published certifications joined via course_packages
  const { data: certs, error: e1 } = await supabase
    .from("certifications")
    .select("id,title,slug,provider")
    .eq("active", true)
    .limit(2000);
  if (e1) throw e1;

  // Curriculum bridge (certification → curriculum)
  const { data: curricula, error: e2 } = await supabase
    .from("curricula")
    .select("id,certification_id")
    .limit(2000);
  if (e2) throw e2;

  const { data: lfs, error: e3 } = await supabase
    .from("learning_fields")
    .select("id,curriculum_id,code,title,sort_order")
    .limit(20000);
  if (e3) throw e3;

  const { data: comps, error: e4 } = await supabase
    .from("competencies")
    .select("id,learning_field_id,code,title")
    .limit(60000);
  if (e4) throw e4;

  return { certs: certs ?? [], curricula: curricula ?? [], lfs: lfs ?? [], comps: comps ?? [] };
}

function build(certs: any[], curricula: any[], lfs: any[], comps: any[]): { entities: Entity[]; edges: Edge[] } {
  const entities: Entity[] = [];
  const edges: Edge[] = [];

  // certification.id → entity_id mapping
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

  // curriculum.id → certification entity_id
  const currCertEntity = new Map<string, string>();
  for (const cu of curricula) {
    if (!cu.id || !cu.certification_id) continue;
    const beruf = certEntityId.get(cu.certification_id);
    if (beruf) currCertEntity.set(cu.id, beruf);
  }

  // Lernfelder
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

  // Kompetenzen
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

  // Stable ordering for hashing
  entities.sort((a, b) => (a.kind + a.key + a.entity_id).localeCompare(b.kind + b.key + b.entity_id));
  edges.sort((a, b) => (a.kind + a.from_id + a.to_id).localeCompare(b.kind + b.from_id + b.to_id));

  return { entities, edges };
}

async function chunkInsert<T>(table: string, snapshot_id: string, rows: T[]): Promise<void> {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({ ...r, snapshot_id }));
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw new Error(`${table} insert failed @${i}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const force = !!body?.force;

    const { certs, curricula, lfs, comps } = await loadSources();
    const { entities, edges } = build(certs, curricula, lfs, comps);

    const hashInput = JSON.stringify({ entities, edges });
    const source_hash = await fnv1a(hashInput);

    // Skip if already published with same hash.
    const { data: cur } = await supabase
      .from("semantic_graph_snapshots")
      .select("id,source_hash,snapshot_at,entity_count,edge_count")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1);

    if (!force && cur?.[0]?.source_hash === source_hash) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "source_hash_unchanged", snapshot_id: cur[0].id, hash: source_hash, entities: entities.length, edges: edges.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: snap, error: snapErr } = await supabase
      .from("semantic_graph_snapshots")
      .insert({ source_hash, entity_count: entities.length, edge_count: edges.length, status: "draft", meta: { source: "materializer" } })
      .select("id")
      .single();
    if (snapErr || !snap) throw snapErr ?? new Error("snapshot insert failed");

    await chunkInsert("semantic_graph_entities", snap.id, entities);
    await chunkInsert("semantic_graph_edges", snap.id, edges);

    const { error: pubErr } = await supabase.rpc("semantic_graph_publish_snapshot", { _snapshot_id: snap.id });
    if (pubErr) throw pubErr;

    return new Response(
      JSON.stringify({ ok: true, published: true, snapshot_id: snap.id, hash: source_hash, entities: entities.length, edges: edges.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
