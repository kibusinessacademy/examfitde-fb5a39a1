/**
 * validate-standalone-bundle-secure
 *
 * Validates a standalone bundle for structural integrity, cryptographic
 * correctness, and security compliance (no leaked URLs, no remote scripts).
 *
 * Input: { bundle_artifact_id }
 * Output: { ok, validation_status, warnings, hard_fails }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function stableStringify(obj: Record<string, unknown>): string {
  const ordered = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
  return JSON.stringify(ordered);
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function verifyLicenseSignature(
  license: Record<string, unknown>,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const { signature, ...payload } = license;
    if (!signature || typeof signature !== "string") return false;

    const key = await crypto.subtle.importKey(
      "spki",
      pemToArrayBuffer(publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const data = new TextEncoder().encode(stableStringify(payload));
    const sig = b64ToUint8(signature as string);

    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  } catch {
    return false;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const FORBIDDEN_PATTERNS = [
  "supabase.co",
  "/functions/v1/",
  "createClient(",
  "cdn.",
  "unpkg.com",
  "jsdelivr.net",
  "http://",
  "https://",
];

const CLEARTEXT_SNAPSHOT_NAMES = [
  "snapshot.json",
  "snapshot.pretty.json",
  "backup-snapshot.json",
];

function findForbiddenPatterns(text: string): string[] {
  return FORBIDDEN_PATTERNS.filter((p) => text.includes(p));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const publicKeyPem = Deno.env.get("LICENSE_PUBLIC_KEY_PEM");
    const body = await req.json();
    const { bundle_artifact_id } = body;

    if (!bundle_artifact_id) {
      return json({ error: "Missing bundle_artifact_id" }, 400);
    }

    console.log(`[validate-bundle] Starting validation for artifact=${bundle_artifact_id}`);

    // ── 1. Load artifact record ──
    const { data: artifact, error: artifactErr } = await sb
      .from("standalone_artifact_versions")
      .select("*")
      .eq("id", bundle_artifact_id)
      .single();

    if (artifactErr || !artifact) {
      return json({ error: "Bundle artifact not found" }, 404);
    }

    const basePath = artifact.metadata?.base_path || artifact.storage_path?.replace(/\/[^/]+$/, "");
    if (!basePath) {
      return json({ error: "Artifact base_path missing" }, 422);
    }

    const bucket = artifact.storage_bucket || "standalone-bundles";
    const warnings: string[] = [];
    const hardFails: string[] = [];

    // ── 2. Download core files ──
    const [manifestRes, licenseRes, snapshotRes, checksumsRes, indexRes] = await Promise.all([
      sb.storage.from(bucket).download(`${basePath}/manifest.json`),
      sb.storage.from(bucket).download(`${basePath}/license.json`),
      sb.storage.from(bucket).download(`${basePath}/snapshot.enc`),
      sb.storage.from(bucket).download(`${basePath}/checksums.json`),
      sb.storage.from(bucket).download(`${basePath}/index.html`),
    ]);

    // ── 3. Structural checks ──
    if (manifestRes.error || !manifestRes.data) hardFails.push("manifest_json_missing");
    if (licenseRes.error || !licenseRes.data) hardFails.push("license_json_missing");
    if (snapshotRes.error || !snapshotRes.data) hardFails.push("snapshot_enc_missing");
    if (checksumsRes.error || !checksumsRes.data) hardFails.push("checksums_json_missing");
    if (indexRes.error || !indexRes.data) warnings.push("index_html_missing");

    // If critical files missing, bail early
    if (hardFails.length > 0) {
      await updateArtifactStatus(sb, bundle_artifact_id, artifact.metadata, "failed", warnings, hardFails);
      return json({ ok: false, validation_status: "failed", warnings, hard_fails: hardFails }, 422);
    }

    const manifestText = await manifestRes.data!.text();
    const licenseText = await licenseRes.data!.text();
    const snapshotEncText = await snapshotRes.data!.text();
    const checksumsText = await checksumsRes.data!.text();

    let manifest: Record<string, unknown>;
    let license: Record<string, unknown>;
    let snapshotEnc: Record<string, unknown>;
    let checksums: Record<string, string>;

    try { manifest = JSON.parse(manifestText); } catch { hardFails.push("manifest_json_invalid"); }
    try { license = JSON.parse(licenseText); } catch { hardFails.push("license_json_invalid"); }
    try { snapshotEnc = JSON.parse(snapshotEncText); } catch { hardFails.push("snapshot_enc_json_invalid"); }
    try { checksums = JSON.parse(checksumsText); } catch { hardFails.push("checksums_json_invalid"); }

    if (hardFails.length > 0) {
      await updateArtifactStatus(sb, bundle_artifact_id, artifact.metadata, "failed", warnings, hardFails);
      return json({ ok: false, validation_status: "failed", warnings, hard_fails: hardFails }, 422);
    }

    // ── 4. Manifest validation ──
    if (!manifest!.entrypoint || manifest!.entrypoint !== "index.html") {
      hardFails.push("manifest_entrypoint_invalid");
    }
    if (manifest!.encrypted_snapshot_path && manifest!.encrypted_snapshot_path !== "snapshot.enc") {
      hardFails.push("manifest_snapshot_path_invalid");
    }

    // ── 5. License validation ──
    if (!license!.license_id || !license!.signature) {
      hardFails.push("license_incomplete");
    }

    // Signature verification
    if (publicKeyPem && license!.signature) {
      const signatureOk = await verifyLicenseSignature(license!, publicKeyPem);
      if (!signatureOk) {
        hardFails.push("license_signature_invalid");
      }
    } else if (!publicKeyPem) {
      // No public key = hard fail in production
      hardFails.push("license_signature_skipped_no_public_key");
    }

    // ── 6. Cross-reference checks ──
    if (manifest!.course_id && license!.course_id && manifest!.course_id !== license!.course_id) {
      hardFails.push("course_id_mismatch");
    }
    if (manifest!.package_id && license!.package_id && manifest!.package_id !== license!.package_id) {
      hardFails.push("package_id_mismatch");
    }

    // ── 7. Encryption format check ──
    if (!snapshotEnc!.iv || !snapshotEnc!.ciphertext) {
      hardFails.push("snapshot_enc_missing_fields");
    }
    if (snapshotEnc!.alg && snapshotEnc!.alg !== "AES-256-GCM") {
      hardFails.push("snapshot_enc_unsupported_algorithm");
    }
    if (!license!.content_key_wrapped || !license!.content_key_wrap_iv) {
      warnings.push("content_key_wrap_missing");
    }

    // ── 8. Checksum verification ──
    const [actualManifestSha, actualLicenseSha, actualSnapshotSha] = await Promise.all([
      sha256Hex(manifestText),
      sha256Hex(licenseText),
      sha256Hex(snapshotEncText),
    ]);

    if (checksums!.manifest_sha256 && checksums!.manifest_sha256 !== actualManifestSha) {
      hardFails.push("manifest_checksum_mismatch");
    }
    if (checksums!.license_sha256 && checksums!.license_sha256 !== actualLicenseSha) {
      hardFails.push("license_checksum_mismatch");
    }
    if (checksums!.snapshot_enc_sha256 && checksums!.snapshot_enc_sha256 !== actualSnapshotSha) {
      hardFails.push("snapshot_checksum_mismatch");
    }

    // ── 9. Security scan: forbidden patterns ──
    const combinedText = [manifestText, licenseText, snapshotEncText].join("\n");
    const forbidden = findForbiddenPatterns(combinedText);
    if (forbidden.length > 0) {
      hardFails.push(`forbidden_patterns:${forbidden.join(",")}`);
    }

    // Also check for unencrypted snapshot
    const snapshotJsonRes = await sb.storage.from(bucket).download(`${basePath}/snapshot.json`);
    if (!snapshotJsonRes.error && snapshotJsonRes.data) {
      hardFails.push("unencrypted_snapshot_present");
    }

    // ── 10. Content checks ──
    const lessonCount = artifact.metadata?.lesson_count ?? manifest!.lesson_count;
    if (!lessonCount || lessonCount <= 0) {
      warnings.push("lesson_count_missing_or_zero");
    }

    // ── 11. Persist result ──
    const validationStatus = hardFails.length > 0 ? "failed" : "passed";
    await updateArtifactStatus(sb, bundle_artifact_id, artifact.metadata, validationStatus, warnings, hardFails);

    console.log(`[validate-bundle] artifact=${bundle_artifact_id} status=${validationStatus} fails=${hardFails.length} warns=${warnings.length}`);

    return json(
      { ok: hardFails.length === 0, validation_status: validationStatus, warnings, hard_fails: hardFails },
      hardFails.length === 0 ? 200 : 422,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[validate-bundle] Fatal:", message);
    return json({ error: message }, 500);
  }
});

async function updateArtifactStatus(
  sb: ReturnType<typeof createClient>,
  artifactId: string,
  existingMeta: Record<string, unknown> | null,
  status: string,
  warnings: string[],
  hardFails: string[],
) {
  await sb
    .from("standalone_artifact_versions")
    .update({
      validation_status: status,
      metadata: {
        ...(existingMeta || {}),
        validation_report: {
          validated_at: new Date().toISOString(),
          validator_version: "1.0.0",
          warnings,
          hard_fails: hardFails,
        },
      },
    })
    .eq("id", artifactId);
}
