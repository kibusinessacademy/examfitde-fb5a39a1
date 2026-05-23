// P13 + P13.1: Export-Preview Manifest (mit Cache + Inline-Limits + Re-Zip)
//
// Modes:
//   - mode="manifest" (default): JSON-Manifest mit Datei-Metadaten + Inline-Text bis MAX_TEXT_INLINE_BYTES.
//     Binärdateien werden NUR als Metadaten zurückgegeben (kein base64 im Manifest).
//   - mode="rezip":            gefiltertes ZIP serverseitig bauen (acceptedPaths) und als ZIP-Stream zurück.
//
// Cache: pro packageId + export_hash (sha256 des Original-ZIP).
//   Storage-Pfad: exports/_manifest_cache/<packageId>/<hash>.json
//
// Audit:
//   - scaffold_manifest_generated   (cache_hit | cache_miss | refreshed)
//   - scaffold_export_filtered      (rezip; accepted/rejected/file_count/total_bytes)
//
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

const MAX_TEXT_INLINE_BYTES = 256 * 1024; // 256 KB

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

const isTextPath = (p: string) =>
  TEXT_EXT.has(p.split(".").pop()?.toLowerCase() ?? "");
const isSecretPath = (p: string) => SECRET_PATTERNS.some((rx) => rx.test(p));

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

async function sha256Hex(buf: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type ManifestFile = {
  path: string;
  mime: string;
  size: number;
  kind: "text" | "binary" | "oversized" | "blocked";
  text?: string;
  blocked_reason?: string;
};

type ManifestResponse = {
  ok: true;
  package_id: string;
  package_key: string | null;
  export_path: string;
  export_hash: string;
  cache_hit: boolean;
  file_count: number;
  total_bytes: number;
  inline_limit_bytes: number;
  files: ManifestFile[];
};

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

  let body: { packageId?: string; mode?: string; acceptedPaths?: string[]; refresh?: boolean } = {};
  try { body = await req.json(); } catch { /* keep empty */ }
  const packageId = body.packageId;
  const mode = body.mode ?? "manifest";
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
    const exportHash = await sha256Hex(buf);

    // ── package_key (für UX-Filename) ──
    const { data: pkgRow } = await sbAdmin
      .from("course_packages")
      .select("package_key")
      .eq("id", packageId)
      .maybeSingle();
    const packageKey: string | null = pkgRow?.package_key ?? null;

    // ── Mode: rezip → filtered ZIP zurückgeben ──
    if (mode === "rezip") {
      const accepted = new Set((body.acceptedPaths ?? []).filter(Boolean));
      if (accepted.size === 0) return json({ error: "acceptedPaths empty" }, 400);
      const srcZip = await JSZip.loadAsync(buf);
      const out = new JSZip();
      let acceptedBytes = 0;
      let acceptedCount = 0;
      const allFiles: { name: string; size: number }[] = [];
      const tasks: Promise<void>[] = [];
      srcZip.forEach((relPath, file) => {
        if (file.dir) return;
        if (isSecretPath(relPath)) return;
        tasks.push((async () => {
          const u8 = await file.async("uint8array");
          allFiles.push({ name: relPath, size: u8.length });
          if (accepted.has(relPath)) {
            out.file(relPath, u8);
            acceptedBytes += u8.length;
            acceptedCount += 1;
          }
        })());
      });
      await Promise.all(tasks);
      if (acceptedCount === 0) return json({ error: "no accepted files matched" }, 400);

      const zipU8 = await out.generateAsync({ type: "uint8array" });
      const totalCount = allFiles.length;
      const totalBytes = allFiles.reduce((a, f) => a + f.size, 0);

      await sbAdmin.rpc("fn_emit_audit", {
        _action_type: "scaffold_export_filtered",
        _target_type: "course_package",
        _target_id: packageId,
        _result_status: "success",
        _payload: {
          package_id: packageId,
          package_key: packageKey,
          export_hash: exportHash,
          file_count: totalCount,
          total_bytes: totalBytes,
          accepted_count: acceptedCount,
          accepted_bytes: acceptedBytes,
          rejected_count: totalCount - acceptedCount,
        },
        _trigger_source: "export-preview-ui",
      });

      const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
      const filename = `export-${packageKey ?? packageId}-${ts}.zip`;
      return new Response(zipU8, {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${filename}"`,
          "x-export-hash": exportHash,
          "x-accepted-count": String(acceptedCount),
          "x-rejected-count": String(totalCount - acceptedCount),
        },
      });
    }

    // ── Mode: manifest ──
    const cachePath = `_manifest_cache/${packageId}/${exportHash}.json`;
    const refresh = body.refresh === true;
    if (!refresh) {
      const { data: cached } = await sbAdmin.storage.from("exports").download(cachePath);
      if (cached) {
        try {
          const text = await cached.text();
          const parsed = JSON.parse(text) as ManifestResponse;
          await sbAdmin.rpc("fn_emit_audit", {
            _action_type: "scaffold_manifest_generated",
            _target_type: "course_package",
            _target_id: packageId,
            _result_status: "success",
            _payload: {
              package_id: packageId,
              package_key: packageKey,
              file_count: parsed.file_count,
              total_bytes: parsed.total_bytes,
              export_path: path,
              export_hash: exportHash,
              cache_hit: true,
            },
            _trigger_source: "export-preview-ui",
          });
          return json({ ...parsed, cache_hit: true });
        } catch { /* fall through to rebuild */ }
      }
    }

    // ── Build fresh manifest ──
    const zip = await JSZip.loadAsync(buf);
    const files: ManifestFile[] = [];
    let totalBytes = 0;
    const entries: { name: string; file: JSZip.JSZipObject }[] = [];
    zip.forEach((relPath, file) => { if (!file.dir) entries.push({ name: relPath, file }); });

    for (const { name, file } of entries) {
      if (isSecretPath(name)) {
        files.push({ path: name, mime: "application/octet-stream", size: 0, kind: "blocked", blocked_reason: "secret_path_pattern" });
        continue;
      }
      const u8 = await file.async("uint8array");
      totalBytes += u8.length;
      const mime = inferMime(name);
      if (isTextPath(name)) {
        if (u8.length > MAX_TEXT_INLINE_BYTES) {
          files.push({ path: name, mime, size: u8.length, kind: "oversized" });
        } else {
          files.push({
            path: name,
            mime,
            size: u8.length,
            kind: "text",
            text: new TextDecoder("utf-8", { fatal: false }).decode(u8),
          });
        }
      } else {
        // Binary: nur Metadaten — Re-Export läuft über mode=rezip
        files.push({ path: name, mime, size: u8.length, kind: "binary" });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    const response: ManifestResponse = {
      ok: true,
      package_id: packageId,
      package_key: packageKey,
      export_path: path,
      export_hash: exportHash,
      cache_hit: false,
      file_count: files.length,
      total_bytes: totalBytes,
      inline_limit_bytes: MAX_TEXT_INLINE_BYTES,
      files,
    };

    // Write cache (best-effort)
    try {
      await sbAdmin.storage.from("exports").upload(
        cachePath,
        new Blob([JSON.stringify(response)], { type: "application/json" }),
        { upsert: true, contentType: "application/json" },
      );
    } catch (e) {
      console.warn("manifest cache write failed:", e);
    }

    await sbAdmin.rpc("fn_emit_audit", {
      _action_type: "scaffold_manifest_generated",
      _target_type: "course_package",
      _target_id: packageId,
      _result_status: "success",
      _payload: {
        package_id: packageId,
        package_key: packageKey,
        file_count: files.length,
        total_bytes: totalBytes,
        export_path: path,
        export_hash: exportHash,
        cache_hit: false,
        refreshed: refresh,
      },
      _trigger_source: "export-preview-ui",
    });

    return json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[export-course-package-manifest]", msg);
    return json({ error: msg }, 500);
  }
});
