import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

type Candidate = {
  source_key: string;
  category: string;
  title_raw: string;
  canonical_title?: string;
  provider_name?: string;
  url: string;
  document_url?: string | null;
  version_label?: string | null;
  metadata?: Record<string, unknown>;
};

async function upsertCandidate(sb: any, c: Candidate) {
  const { error } = await sb.from("curriculum_intake_candidates").upsert({
    source_key: c.source_key,
    category: c.category,
    title_raw: c.title_raw,
    canonical_title: c.canonical_title ?? c.title_raw,
    provider_name: c.provider_name ?? null,
    url: c.url,
    document_url: c.document_url ?? null,
    version_label: c.version_label ?? null,
    metadata: c.metadata ?? {},
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "url" });

  if (error) throw error;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const inserted: Candidate[] = [];

  // Registry-driven discovery stubs.
  // In production, replace with real fetch + parse from each source domain.
  const seedCandidates: Candidate[] = [
    {
      source_key: "kmk",
      category: "dual",
      title_raw: "Rahmenlehrplan – Beispielberuf",
      provider_name: "KMK",
      url: "https://example.invalid/kmk/example",
      document_url: "https://example.invalid/kmk/example.pdf",
      metadata: { source_class: "rahmenlehrplan" },
    },
    {
      source_key: "bibb",
      category: "dual",
      title_raw: "Verzeichnis anerkannter Ausbildungsberuf – Beispiel",
      provider_name: "BIBB",
      url: "https://example.invalid/bibb/example",
      metadata: { source_class: "directory_entry" },
    },
    {
      source_key: "ihk",
      category: "fortbildung_ihk",
      title_raw: "Geprüfter Fachwirt – Beispiel",
      provider_name: "IHK",
      url: "https://example.invalid/ihk/example",
      metadata: { award_type: "fachwirt" },
    },
    {
      source_key: "hwk",
      category: "fortbildung_hwk",
      title_raw: "Meisterprüfung – Beispiel",
      provider_name: "HWK",
      url: "https://example.invalid/hwk/example",
      metadata: { award_type: "meister" },
    },
  ];

  for (const c of seedCandidates) {
    try {
      await upsertCandidate(sb, c);
      inserted.push(c);
    } catch (e) {
      // skip duplicates silently
    }
  }

  // Enqueue download jobs
  for (const c of inserted) {
    const { data: row } = await sb
      .from("curriculum_intake_candidates")
      .select("id")
      .eq("url", c.url)
      .single();

    if (row?.id) {
      await sb.from("curriculum_intake_jobs").upsert({
        job_type: "download",
        candidate_id: row.id,
        payload: { url: c.document_url || c.url, source_key: c.source_key },
        idempotency_key: `download:${row.id}`,
      }, { onConflict: "idempotency_key" });
    }
  }

  return json(200, { ok: true, discovered: inserted.length }, origin);
});
