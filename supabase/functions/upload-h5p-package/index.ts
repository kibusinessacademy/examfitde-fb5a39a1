// Edge Function: upload-h5p-package
// Accepts a multipart/form-data upload of a .h5p (zip) package, unpacks it,
// uploads each file to the private `h5p-content` bucket under a content_id folder,
// and returns the content_id ready to be linked to a lesson.
//
// Auth: requires admin role (verified via has_role RPC with the caller's JWT).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "h5p-content";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap per package
const MAX_FILES = 2000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFolderId(): string {
  // RFC4122 v4 without hyphens, prefixed for readability in storage
  const u = crypto.randomUUID().replace(/-/g, "");
  return `h5p_${u}`;
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "json": return "application/json";
    case "js": return "application/javascript";
    case "css": return "text/css";
    case "html": case "htm": return "text/html";
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "woff": return "font/woff";
    case "woff2": return "font/woff2";
    case "ttf": return "font/ttf";
    case "otf": return "font/otf";
    case "mp3": return "audio/mpeg";
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "unauthorized" }, 401);

  // 1) Verify caller is admin via has_role using their JWT
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);

  const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (roleErr) return jsonResponse({ error: "role check failed", detail: roleErr.message }, 500);
  if (!isAdmin) return jsonResponse({ error: "forbidden: admin role required" }, 403);

  // 2) Parse multipart form
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return jsonResponse({ error: "invalid multipart body", detail: String(e) }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonResponse({ error: "missing 'file' field" }, 400);
  if (file.size > MAX_BYTES) return jsonResponse({ error: `file too large (>${MAX_BYTES} bytes)` }, 413);

  // 3) Unpack zip
  const buf = new Uint8Array(await file.arrayBuffer());
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    return jsonResponse({ error: "not a valid .h5p (zip) archive", detail: String(e) }, 400);
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length === 0) return jsonResponse({ error: "empty archive" }, 400);
  if (entries.length > MAX_FILES) return jsonResponse({ error: `too many files (>${MAX_FILES})` }, 413);

  // 4) Validate h5p.json present
  const h5pJsonEntry = entries.find((f) => f.name === "h5p.json");
  if (!h5pJsonEntry) return jsonResponse({ error: "invalid package: h5p.json not found at archive root" }, 400);

  let h5pManifest: Record<string, unknown> | null = null;
  try {
    const txt = await h5pJsonEntry.async("string");
    h5pManifest = JSON.parse(txt);
  } catch {
    return jsonResponse({ error: "h5p.json is not valid JSON" }, 400);
  }

  // 5) Upload all files into a fresh content folder using service role
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const contentId = safeFolderId();

  const uploaded: string[] = [];
  for (const entry of entries) {
    // Reject path traversal
    if (entry.name.includes("..") || entry.name.startsWith("/")) {
      return jsonResponse({ error: `unsafe path in archive: ${entry.name}` }, 400);
    }
    const data = await entry.async("uint8array");
    const path = `${contentId}/${entry.name}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, data, {
      contentType: guessMime(entry.name),
      upsert: false,
    });
    if (upErr) {
      // Best-effort cleanup of partial upload
      try {
        const allPaths = uploaded.map((p) => p);
        if (allPaths.length > 0) await admin.storage.from(BUCKET).remove(allPaths);
      } catch { /* ignore */ }
      return jsonResponse({ error: "storage upload failed", detail: upErr.message, path }, 500);
    }
    uploaded.push(path);
  }

  // 6) Audit log
  await admin.from("auto_heal_log").insert({
    action_type: "admin_h5p_upload",
    target_type: "h5p_content",
    target_id: contentId,
    result_status: "success",
    metadata: {
      actor: userData.user.id,
      file_count: uploaded.length,
      bytes: file.size,
      title: (h5pManifest as any)?.title ?? null,
      mainLibrary: (h5pManifest as any)?.mainLibrary ?? null,
    },
  });

  return jsonResponse({
    ok: true,
    content_id: contentId,
    file_count: uploaded.length,
    title: (h5pManifest as any)?.title ?? null,
    mainLibrary: (h5pManifest as any)?.mainLibrary ?? null,
  });
});
