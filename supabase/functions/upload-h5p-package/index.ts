// Edge Function: upload-h5p-package
// Validates + unpacks a .h5p (zip) package and uploads it into the private
// `h5p-content` bucket under a fresh content_id. Returns validation report.
//
// Auth: requires admin role (verified via has_role RPC with the caller's JWT).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "h5p-content";
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 2000;

type Check = { key: string; ok: boolean; detail?: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, error: string, checks: Check[], extra: Record<string, unknown> = {}) {
  return jsonResponse({ ok: false, error, validation: { checks, passed: false }, ...extra }, status);
}

function safeFolderId(): string {
  const u = crypto.randomUUID().replace(/-/g, "");
  return `h5p_${u}`;
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const m: Record<string, string> = {
    json: "application/json", js: "application/javascript", css: "text/css",
    html: "text/html", htm: "text/html", svg: "image/svg+xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", woff: "font/woff", woff2: "font/woff2",
    ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg",
    mp4: "video/mp4", webm: "video/webm", txt: "text/plain",
  };
  return m[ext] ?? "application/octet-stream";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);

  const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
    _user_id: userData.user.id, _role: "admin",
  });
  if (roleErr) return jsonResponse({ error: "role check failed", detail: roleErr.message }, 500);
  if (!isAdmin) return jsonResponse({ error: "forbidden: admin role required" }, 403);

  // ── Multipart Parse
  let form: FormData;
  try { form = await req.formData(); }
  catch (e) { return jsonResponse({ error: "invalid multipart body", detail: String(e) }, 400); }

  const file = form.get("file");
  const checks: Check[] = [];

  // Validation 1: file present
  const filePresent = file instanceof File;
  checks.push({ key: "file_present", ok: filePresent, detail: filePresent ? `${(file as File).name} (${(file as File).size} B)` : "no 'file' field" });
  if (!filePresent) return fail(400, "missing 'file' field", checks);

  const f = file as File;

  // Validation 2: extension
  const extOk = f.name.toLowerCase().endsWith(".h5p");
  checks.push({ key: "extension_h5p", ok: extOk, detail: extOk ? ".h5p" : `got "${f.name.split(".").pop()}"` });
  if (!extOk) return fail(400, "wrong file extension (expected .h5p)", checks);

  // Validation 3: size
  const sizeOk = f.size > 0 && f.size <= MAX_BYTES;
  checks.push({ key: "size_within_limit", ok: sizeOk, detail: `${f.size} B / max ${MAX_BYTES} B` });
  if (!sizeOk) return fail(413, "file size out of range", checks);

  // Validation 4: valid zip
  const buf = new Uint8Array(await f.arrayBuffer());
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); }
  catch (e) {
    checks.push({ key: "zip_parsable", ok: false, detail: String(e) });
    return fail(400, "not a valid .h5p (zip) archive", checks);
  }
  const entries = Object.values(zip.files).filter((x) => !x.dir);
  checks.push({ key: "zip_parsable", ok: true, detail: `${entries.length} files` });

  // Validation 5: file count
  const countOk = entries.length > 0 && entries.length <= MAX_FILES;
  checks.push({ key: "file_count_in_range", ok: countOk, detail: `${entries.length} (max ${MAX_FILES})` });
  if (!countOk) return fail(413, "archive file count out of range", checks);

  // Validation 6: no path traversal
  const unsafe = entries.find((e) => e.name.includes("..") || e.name.startsWith("/"));
  checks.push({ key: "no_path_traversal", ok: !unsafe, detail: unsafe ? unsafe.name : "clean" });
  if (unsafe) return fail(400, `unsafe path in archive: ${unsafe.name}`, checks);

  // Validation 7: h5p.json present at root
  const h5pJsonEntry = entries.find((e) => e.name === "h5p.json");
  checks.push({ key: "manifest_h5p_json", ok: !!h5pJsonEntry, detail: h5pJsonEntry ? "found" : "missing at archive root" });
  if (!h5pJsonEntry) return fail(400, "invalid package: h5p.json not found at archive root", checks);

  // Validation 8: h5p.json parses + has required fields
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(await h5pJsonEntry.async("string"));
    checks.push({ key: "manifest_parses", ok: true });
  } catch (e) {
    checks.push({ key: "manifest_parses", ok: false, detail: String(e) });
    return fail(400, "h5p.json is not valid JSON", checks);
  }
  const hasTitle = typeof manifest.title === "string" && (manifest.title as string).trim().length > 0;
  const hasMainLib = typeof manifest.mainLibrary === "string" && (manifest.mainLibrary as string).trim().length > 0;
  checks.push({ key: "manifest_has_title", ok: hasTitle });
  checks.push({ key: "manifest_has_mainLibrary", ok: hasMainLib, detail: hasMainLib ? String(manifest.mainLibrary) : "missing" });
  if (!hasMainLib) return fail(400, "h5p.json missing required field 'mainLibrary'", checks);

  // Validation 9: content/content.json present
  const contentJson = entries.find((e) => e.name === "content/content.json");
  checks.push({ key: "content_content_json", ok: !!contentJson, detail: contentJson ? "found" : "content/content.json missing" });
  if (!contentJson) return fail(400, "invalid package: content/content.json missing", checks);

  // Validation 10: at least one library directory matching mainLibrary present
  const mainLib = String(manifest.mainLibrary);
  const libRoots = new Set<string>();
  for (const e of entries) {
    const seg = e.name.split("/")[0];
    if (/^H5P\..+-\d+\.\d+/i.test(seg) || /^[A-Z][A-Za-z0-9]+\.[A-Za-z0-9]+-\d+\.\d+/.test(seg)) libRoots.add(seg);
  }
  const mainLibPresent = [...libRoots].some((dir) => dir.startsWith(`${mainLib}-`));
  checks.push({ key: "main_library_files_present", ok: mainLibPresent, detail: mainLibPresent ? mainLib : `no folder for ${mainLib}-* (found: ${[...libRoots].slice(0, 5).join(", ") || "none"})` });
  if (!mainLibPresent) return fail(400, `main library folder for '${mainLib}' missing in archive`, checks);

  // ── Upload via service role
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const contentId = safeFolderId();

  const uploaded: string[] = [];
  for (const entry of entries) {
    const data = await entry.async("uint8array");
    const path = `${contentId}/${entry.name}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, data, {
      contentType: guessMime(entry.name), upsert: false,
    });
    if (upErr) {
      try { if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded); } catch { /* ignore */ }
      checks.push({ key: "storage_upload", ok: false, detail: `${path}: ${upErr.message}` });
      return fail(500, "storage upload failed", checks, { content_id: contentId });
    }
    uploaded.push(path);
  }
  checks.push({ key: "storage_upload", ok: true, detail: `${uploaded.length} files` });

  // Audit
  await admin.from("auto_heal_log").insert({
    action_type: "admin_h5p_upload",
    target_type: "h5p_content",
    target_id: contentId,
    result_status: "success",
    metadata: {
      actor: userData.user.id,
      file_count: uploaded.length,
      bytes: f.size,
      title: (manifest as any)?.title ?? null,
      mainLibrary: mainLib,
      validation: checks,
    },
  });

  return jsonResponse({
    ok: true,
    content_id: contentId,
    file_count: uploaded.length,
    title: (manifest as any)?.title ?? null,
    mainLibrary: mainLib,
    validation: { checks, passed: true },
  });
});
