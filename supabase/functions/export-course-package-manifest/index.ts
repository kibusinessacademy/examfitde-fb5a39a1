// P13: Export-Preview Manifest
// Liefert die Dateiliste eines Lernpaket-Exports als JSON (statt ZIP).
// Strategie:
//   1) Existing export-course-package aufrufen → erzeugt/aktualisiert ZIP in Storage `exports`.
//   2) ZIP aus Storage laden, mit JSZip entpacken.
//   3) Pro File ein Manifest-Eintrag mit Inhalt (text oder base64) zurückgeben.
//   4) Defense-in-depth: Secret-Pfade hart filtern.
//   5) Audit via fn_emit_audit.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const SECRET_PATTERNS = [
  /\.env(\.|$)/i,
  /(^|\/)secrets?\//i,
  /service[_-]?role/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
];

const TEXT_EXT = new Set([
  "json", "ndjson", "md", "txt", "csv", "html", "xml", "yaml", "yml", "log",
]);

function isTextPath(p: string) {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}

function isSecretPath(p: string) {
  return SECRET_PATTERNS.some((rx) => rx.test(p));
}

function inferMime(p: string) {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return {
    json: "application/json",
    ndjson: "application/x-ndjson",
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    html: "text/html",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    log: "text/plain",
  }[ext] ?? "application/octet-stream";
}

function bytesToBase64(u8: Uint8Array) {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Auth: require admin ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthenticated" }, 401);
  const { data: hasAdmin, error: roleErr } = await sbAdmin.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (roleErr || !hasAdmin) return json({ error: "forbidden" }, 403);

  const { packageId } = await req.json().catch(() => ({} as { packageId?: string }));
  if (!packageId) return json({ error: "packageId required" }, 400);

  try {
    // ── 1) Trigger existing exporter (idempotent — re-uses storage path) ──
    const exportResp = await fetch(`${SUPABASE_URL}/functions/v1/export-course-package`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ packageId }),
    });
    if (!exportResp.ok) {
      const t = await exportResp.text();
      return json({ error: `export failed: ${exportResp.status} ${t}` }, 502);
    }
    const exportJson = await exportResp.json();
    const path: string | undefined = exportJson.fileName;
    if (!path) return json({ error: "export returned no fileName" }, 502);

    // ── 2) Download ZIP from storage ──
    const { data: blob, error: dlErr } = await sbAdmin.storage.from("exports").download(path);
    if (dlErr || !blob) return json({ error: `download: ${dlErr?.message ?? "no blob"}` }, 502);

    const buf = new Uint8Array(await blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    // ── 3) Build manifest ──
    type ManifestFile = {
      path: string;
      mime: string;
      size: number;
      kind: "text" | "binary" | "blocked";
      text?: string;
      base64?: string;
      blocked_reason?: string;
    };
    const files: ManifestFile[] = [];
    let totalBytes = 0;

    const entries: { name: string; file: JSZip.JSZipObject }[] = [];
    zip.forEach((relPath, file) => {
      if (!file.dir) entries.push({ name: relPath, file });
    });

    for (const { name, file } of entries) {
      if (isSecretPath(name)) {
        files.push({
          path: name,
          mime: "application/octet-stream",
          size: 0,
          kind: "blocked",
          blocked_reason: "secret_path_pattern",
        });
        continue;
      }
      const u8 = await file.async("uint8array");
      totalBytes += u8.length;
      const mime = inferMime(name);
      if (isTextPath(name)) {
        files.push({
          path: name,
          mime,
          size: u8.length,
          kind: "text",
          text: new TextDecoder("utf-8", { fatal: false }).decode(u8),
        });
      } else {
        files.push({
          path: name,
          mime,
          size: u8.length,
          kind: "binary",
          base64: bytesToBase64(u8),
        });
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path));

    // ── 4) Audit ──
    await sbAdmin.rpc("fn_emit_audit", {
      _action_type: "scaffold_manifest_generated",
      _target_type: "course_package",
      _target_id: packageId,
      _result_status: "success",
      _payload: {
        package_id: packageId,
        file_count: files.length,
        total_bytes: totalBytes,
        export_path: path,
      },
      _trigger_source: "export-preview-ui",
    });

    return json({
      ok: true,
      package_id: packageId,
      export_path: path,
      file_count: files.length,
      total_bytes: totalBytes,
      files,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[export-course-package-manifest]", msg);
    return json({ error: msg }, 500);
  }
});
