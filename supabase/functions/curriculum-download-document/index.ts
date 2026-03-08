import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

async function sha256Hex(input: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const body = await req.json().catch(() => ({}));
  const candidateId = body.candidate_id as string | undefined;

  if (!candidateId) return json(400, { ok: false, error: "candidate_id required" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: candidate, error } = await sb
    .from("curriculum_intake_candidates")
    .select("*")
    .eq("id", candidateId)
    .single();

  if (error || !candidate) return json(404, { ok: false, error: "candidate not found" }, origin);

  const targetUrl = candidate.document_url || candidate.url;

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      redirect: "follow",
      headers: { "User-Agent": "ExamFit Curriculum Intake/1.0" },
    });
  } catch (e) {
    return json(502, { ok: false, error: `fetch failed: ${(e as Error).message}` }, origin);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  const checksum = await sha256Hex(buf);

  const ext = res.headers.get("content-type")?.includes("pdf") ? "pdf" : "html";
  const storagePath = `curriculum-intake/${candidate.id}.${ext}`;

  const { error: upErr } = await sb.storage
    .from("private-source-documents")
    .upload(storagePath, buf, {
      contentType: res.headers.get("content-type") || "application/octet-stream",
      upsert: true,
    });

  if (upErr) return json(500, { ok: false, error: upErr.message }, origin);

  const { data: doc, error: docErr } = await sb
    .from("curriculum_source_documents")
    .insert({
      candidate_id: candidate.id,
      document_type: ext,
      storage_path: storagePath,
      source_url: targetUrl,
      checksum_sha256: checksum,
      content_length: buf.byteLength,
      http_status: res.status,
    })
    .select("id")
    .single();

  if (docErr) return json(500, { ok: false, error: docErr.message }, origin);

  await sb.from("curriculum_intake_candidates")
    .update({ intake_status: "downloaded" })
    .eq("id", candidate.id);

  await sb.from("curriculum_intake_jobs").upsert({
    job_type: "parse",
    candidate_id: candidate.id,
    source_document_id: doc.id,
    payload: { document_type: ext },
    idempotency_key: `parse:${doc.id}`,
  }, { onConflict: "idempotency_key" });

  return json(200, { ok: true, document_id: doc.id, storage_path: storagePath }, origin);
});
