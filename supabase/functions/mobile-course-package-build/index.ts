// MOBILE.COURSE.PACKAGE.OS.1 — Phase C
// Builds a per-course Capacitor mobile release source bundle (ZIP).
//
// SSOT-GUARD: Kursinhalte werden NICHT dupliziert — Bundle referenziert nur den
// existierenden course-export ZIP via signed URL. Diese Function liefert ausschließlich
// die Mobile-Shell, Store-Listings, IAP-Konfiguration, CI-Workflows und Governance-Notes.
//
// IAP-SSOT: Receipt-Validierung läuft ausschließlich über `validate-iap-receipt`
// (Phase B). Zugriffs-Read ausschließlich über `check_product_access_by_curriculum`.
// Kein lokaler Unlock, keine Service-Keys, keine Admin-Routen im Bundle.
//
// INVARIANT_OVERRIDE: BRIDGE.REQUIRED — reason: market-distribution-channel

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

interface Manifest {
  course_id: string;
  curriculum_id: string | null;
  product_id: string | null;
  content_export_id: string | null;
  bundle_id: string;
  android_package_id: string | null;
  ios_bundle_id: string | null;
  app_name: string;
  short_name: string;
  version_name: string;
  version_code: number;
  build_number: number;
  default_locale: string;
  supported_locales: string[];
  primary_color: string;
  icon_url: string | null;
  feature_graphic_url: string | null;
  ios_iap_product_id: string | null;
  android_iap_product_id: string | null;
  iap_price_tier: string | null;
  store_skus: Record<string, unknown>;
  store_listing_de: Record<string, unknown>;
  store_listing_en: Record<string, unknown>;
  copyright_holder: string;
  license_text: string;
  privacy_url: string;
  imprint_url: string;
  support_url: string;
  marketing_url: string;
  contact_email: string;
  category: string;
  age_rating_hint: string;
  app_store_listing_status: string;
  google_play_listing_status: string;
  release_status: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validateBundleId(id: string): boolean {
  // Reverse-DNS, at least 2 segments, lowercase alnum + hyphens
  return /^[a-z][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)+$/.test(id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const sb = createClient(url, service);
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const courseId = String(body?.course_id || "");
    if (!courseId) return json({ error: "course_id required" }, 400);

    const { data: m, error: mErr } = await sb
      .from("mobile_course_app_manifest")
      .select("*")
      .eq("course_id", courseId)
      .maybeSingle();
    if (mErr) return json({ error: mErr.message }, 500);
    if (!m) return json({ error: "manifest not configured for course — create one first" }, 404);

    const manifest = m as Manifest;

    if (!validateBundleId(manifest.bundle_id)) {
      return json({ error: `invalid bundle_id (reverse-DNS required): ${manifest.bundle_id}` }, 400);
    }
    const androidPkg = manifest.android_package_id || manifest.bundle_id;
    const iosBundle = manifest.ios_bundle_id || manifest.bundle_id;
    if (!validateBundleId(androidPkg)) return json({ error: `invalid android_package_id: ${androidPkg}` }, 400);
    if (!validateBundleId(iosBundle)) return json({ error: `invalid ios_bundle_id: ${iosBundle}` }, 400);

    const { data: course, error: cErr } = await sb
      .from("courses")
      .select("id, title, slug, description, status, visibility")
      .eq("id", courseId)
      .maybeSingle();
    if (cErr || !course) return json({ error: "course not found" }, 404);

    await sb.from("mobile_course_app_manifest")
      .update({ last_build_status: "building", last_build_error: null })
      .eq("course_id", courseId);

    // SSOT content reference — never duplicate course content
    const { data: existingExport } = await sb
      .from("course_package_outputs")
      .select("payload, last_exported_at, package_id")
      .eq("output_key", "export_zip_with_player")
      .order("last_exported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contentExportUrl = (existingExport?.payload as any)?.downloadUrl || null;
    const contentExportRef = manifest.content_export_id
      || (existingExport?.package_id ?? null);

    const generatedAt = new Date().toISOString();
    const commitSha = Deno.env.get("GITHUB_SHA") || null;
    const builderVersion = "mobile-course-package-build@phase-c-1.0.0";

    // ── Hashes (deterministic listing fingerprint) ───────────────────────
    const playDe = buildPlayListing(manifest, course, "de");
    const playEn = buildPlayListing(manifest, course, "en");
    const appStoreDe = buildAppStoreListing(manifest, course, "de");
    const appStoreEn = buildAppStoreListing(manifest, course, "en");
    const listingHash = await sha256Hex(JSON.stringify({
      playDe, playEn, appStoreDe, appStoreEn,
    }));
    const iapConfig = {
      platform: "dual",
      ios: {
        sku: manifest.ios_iap_product_id || null,
        bundle_id: iosBundle,
      },
      android: {
        sku: manifest.android_iap_product_id || null,
        package_id: androidPkg,
      },
      curriculum_id: manifest.curriculum_id,
      course_id: manifest.course_id,
      product_id: manifest.product_id,
      validation_endpoint: "validate-iap-receipt",
      access_read_path: "check_product_access_by_curriculum",
      cache_invalidation_keys: [
        "product-access",
        "product-access-by-curriculum",
        "product-access-curriculum",
        "entitlements",
        "course-access",
        "learner-course-grants",
      ],
    };
    const iapConfigHash = await sha256Hex(JSON.stringify(iapConfig));

    const buildInfo = {
      generated_at: generatedAt,
      manifest_id: manifest.course_id,
      product_id: manifest.product_id,
      curriculum_id: manifest.curriculum_id,
      course_id: manifest.course_id,
      app_version: manifest.version_name,
      build_number: manifest.build_number,
      version_code: manifest.version_code,
      commit_sha: commitSha,
      builder_version: builderVersion,
      content_export_reference: contentExportRef,
      content_export_url: contentExportUrl,
      listing_hash: listingHash,
      iap_config_hash: iapConfigHash,
    };

    // ── Build the Capacitor source bundle ────────────────────────────────
    const zip = new JSZip();
    const safeBundle = manifest.bundle_id.replace(/\./g, "-");

    // App Shell
    zip.file("README.md", buildReadme(manifest, course));
    zip.file("capacitor.config.ts", buildCapacitorConfig(manifest, iosBundle, androidPkg));
    zip.file("package.json", buildPackageJson(manifest));
    zip.file("src/course-manifest.json", JSON.stringify({
      course_id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      curriculum_id: manifest.curriculum_id,
      product_id: manifest.product_id,
      bundle_id: manifest.bundle_id,
      version: { name: manifest.version_name, code: manifest.version_code, build: manifest.build_number },
      content_export_reference: contentExportRef,
      content_export_url: contentExportUrl,
      content_export_note: "Lade Kursinhalte zur Build-Zeit von dieser URL und packe sie in /assets/course/. URL ist 7 Tage gültig — vor jedem Release neu generieren via /admin/tools/bulk-course-export.",
      locales: { default: manifest.default_locale, supported: manifest.supported_locales },
      legal: {
        copyright_holder: manifest.copyright_holder,
        privacy_url: manifest.privacy_url,
        imprint_url: manifest.imprint_url,
        support_url: manifest.support_url,
        marketing_url: manifest.marketing_url,
        contact_email: manifest.contact_email,
      },
    }, null, 2));
    zip.file("src/iap.config.ts", buildIapConfigTs(iapConfig));
    zip.file("src/access-policy.ts", buildAccessPolicyTs());
    zip.file("src/build-info.json", JSON.stringify(buildInfo, null, 2));

    // Store Metadata
    zip.file("store/app-store/listing.de.json", JSON.stringify(appStoreDe, null, 2));
    zip.file("store/app-store/listing.en.json", JSON.stringify(appStoreEn, null, 2));
    zip.file("store/app-store/README.md", APP_STORE_README);
    zip.file("store/google-play/listing.de.json", JSON.stringify(playDe, null, 2));
    zip.file("store/google-play/listing.en.json", JSON.stringify(playEn, null, 2));
    zip.file("store/google-play/README.md", PLAY_README);
    zip.file("store/privacy/README.md", PRIVACY_README);
    zip.file("store/review-notes.md", buildReviewNotes(manifest, course));

    // Screenshots
    zip.file("store/screenshots/README.md", SCREENSHOT_README);
    zip.file("store/screenshots/required-sizes.json", JSON.stringify(REQUIRED_SCREENSHOT_SIZES, null, 2));
    zip.file("store/screenshots/phone/.gitkeep", "");
    zip.file("store/screenshots/tablet/.gitkeep", "");
    zip.file("store/screenshots/dark/.gitkeep", "");
    zip.file("store/screenshots/light/.gitkeep", "");

    // Legal
    zip.file("LICENSE.txt", `Copyright © ${new Date().getFullYear()} ${manifest.copyright_holder}\nAll rights reserved.\n\n${manifest.license_text || ""}`);
    zip.file("COPYRIGHT.md", buildCopyright(manifest, course));
    zip.file("PRIVACY.md", `# Datenschutz\n\nDie vollständige Datenschutzerklärung ist online verfügbar:\n${manifest.privacy_url}\n`);
    zip.file("IMPRINT.md", `# Impressum\n\n${manifest.imprint_url}\n`);

    // CI Workflows
    zip.file(".github/workflows/android-release.yml", ANDROID_WORKFLOW);
    zip.file(".github/workflows/ios-release.yml", IOS_WORKFLOW);
    zip.file(".github/workflows/mobile-package-check.yml", PACKAGE_CHECK_WORKFLOW);

    // Governance Notes
    zip.file("RELEASE_CHECKLIST.md", buildReleaseChecklist(manifest, course));
    zip.file("SSOT_NOTES.md", SSOT_NOTES);
    zip.file("IAP_NOTES.md", IAP_NOTES);
    zip.file("NO_SECRETS.md", NO_SECRETS);
    zip.file("KNOWN_LIMITATIONS.md", KNOWN_LIMITATIONS);

    // Misc
    zip.file(".gitignore", "node_modules/\ndist/\nandroid/app/release/\nios/App/build/\n*.keystore\n*.jks\n.env\n.env.local\n");
    zip.file(".nvmrc", "20\n");
    zip.file("docs/local-build.md", LOCAL_BUILD_DOCS);
    zip.file("docs/signing.md", SIGNING_DOCS);
    zip.file("docs/iap-setup.md", IAP_DOCS);

    const bytes = await zip.generateAsync({ type: "uint8array" });

    // Upload
    const bucket = "course-exports";
    const path = `mobile-bundles/${safeBundle}/v${manifest.version_name}-b${manifest.build_number}-${Date.now()}.zip`;
    const { error: upErr } = await sb.storage.from(bucket).upload(path, bytes, {
      contentType: "application/zip",
      upsert: true,
    });
    if (upErr) {
      await sb.from("mobile_course_app_manifest")
        .update({ last_build_status: "failed", last_build_error: upErr.message })
        .eq("course_id", courseId);
      return json({ error: `upload failed: ${upErr.message}` }, 500);
    }

    const { data: signed } = await sb.storage.from(bucket).createSignedUrl(path, 7 * 24 * 3600);

    await sb.from("mobile_course_app_manifest").update({
      last_built_at: generatedAt,
      last_build_status: "ready",
      last_build_output_url: signed?.signedUrl || null,
      last_build_error: null,
    }).eq("course_id", courseId);

    return json({
      ok: true,
      downloadUrl: signed?.signedUrl,
      fileSize: bytes.length,
      bundle_id: manifest.bundle_id,
      version: `${manifest.version_name} (${manifest.version_code}) build ${manifest.build_number}`,
      build_info: buildInfo,
      listing_hash: listingHash,
      iap_config_hash: iapConfigHash,
      contains: {
        capacitor_config: true,
        ci_workflows: ["android-release.yml", "ios-release.yml", "mobile-package-check.yml"],
        store_metadata: ["google-play", "app-store", "privacy", "review-notes"],
        governance_notes: ["RELEASE_CHECKLIST.md", "SSOT_NOTES.md", "IAP_NOTES.md", "NO_SECRETS.md", "KNOWN_LIMITATIONS.md"],
        iap_stub: true,
        legal: ["LICENSE.txt", "COPYRIGHT.md", "PRIVACY.md", "IMPRINT.md"],
        content_export_url: contentExportUrl,
        content_export_warning: contentExportUrl ? null : "Kein Kurs-Content-Export gefunden. Bitte zuerst /admin/tools/bulk-course-export ausführen.",
      },
      known_limitations: ["IAP.STATUS.LIFECYCLE — expired/refunded/cancelled wird in einem späteren Cut behandelt."],
      next_steps: [
        "1. ZIP herunterladen, in eigenes Git-Repo entpacken.",
        "2. `npm install` ausführen.",
        "3. Kursinhalt von content_export_url herunterladen und nach `assets/course/` entpacken.",
        "4. `npm run build && npx cap sync` ausführen.",
        "5. Android: `npx cap add android && cd android && ./gradlew bundleRelease` (Keystore in CI-Secret `ANDROID_KEYSTORE_BASE64`).",
        "6. iOS: `npx cap add ios && open ios/App/App.xcworkspace` → Xcode Archive → Transporter → App Store Connect.",
        "7. ODER GitHub Actions Workflows nutzen (Secrets siehe docs/signing.md).",
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[mobile-course-package-build] error:", msg);
    return json({ error: msg }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────────

function buildCapacitorConfig(m: Manifest, iosBundle: string, androidPkg: string): string {
  return `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${m.bundle_id}',
  appName: '${m.app_name.replace(/'/g, "\\'")}',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: '${m.short_name.replace(/'/g, "\\'")}',
    backgroundColor: '${m.primary_color}'
    // iOS bundle id (App Store Connect): ${iosBundle}
  },
  android: {
    backgroundColor: '${m.primary_color}',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
    // Android applicationId (Play Console): ${androidPkg}
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '${m.primary_color}',
      showSpinner: false
    },
    StatusBar: { style: 'LIGHT', backgroundColor: '${m.primary_color}' }
  }
};

export default config;
`;
}

function buildPackageJson(m: Manifest): string {
  return JSON.stringify({
    name: m.bundle_id.replace(/\./g, "-"),
    version: m.version_name,
    private: true,
    scripts: {
      build: "echo 'Replace with your Vite/Next build step'",
      "cap:sync": "npx cap sync",
      "android:dev": "npx cap run android",
      "ios:dev": "npx cap run ios",
      "android:release": "cd android && ./gradlew bundleRelease",
    },
    dependencies: {
      "@capacitor/core": "^6.1.2",
      "@capacitor/android": "^6.1.2",
      "@capacitor/ios": "^6.1.2",
      "@capacitor/splash-screen": "^6.0.2",
      "@capacitor/status-bar": "^6.0.1",
      "@capacitor-community/in-app-purchases": "^1.0.0",
    },
    devDependencies: {
      "@capacitor/cli": "^6.1.2",
      typescript: "^5.5.0",
    },
  }, null, 2);
}

function buildIapConfigTs(cfg: Record<string, unknown>): string {
  return `// IAP Configuration — SSOT-locked (Phase B + Phase C)
//
// Receipt validation: ausschließlich über die Edge Function \`validate-iap-receipt\`.
// Zugriffs-Read: ausschließlich über RPC \`check_product_access_by_curriculum\`.
//
// VERBOTEN: lokale Unlock-Flags, direkte Reads auf entitlements/store_receipts,
// hardcoded entitlement grants im Client.

export const IAP_CONFIG = ${JSON.stringify(cfg, null, 2)} as const;

export const RECEIPT_VALIDATION_ENDPOINT = "validate-iap-receipt";
export const ACCESS_READ_RPC = "check_product_access_by_curriculum";
`;
}

function buildAccessPolicyTs(): string {
  return `// Access Policy — SSOT-locked
//
// Mobile-Shell liest Zugriff NUR über bestehende Access-Hooks der Web-Codebase.
// Keine eigene Mobile-Entitlement-Logik. Kein lokaler Unlock.
//
// Schreibpfad (Server-only, via validate-iap-receipt → create_store_entitlement):
//   store_receipts → create_store_entitlement → entitlements
//
// Lesepfad (Client):
//   useProductAccessByCurriculum() → check_product_access_by_curriculum RPC
//
// Verbotene Identifier (Guard im Web-Repo: src/__tests__/guards/iap-shadow-paths.test.ts):
//   - grantMobileAccess
//   - unlockCourseLocally
//   - createMobileEntitlement
//   - validateReceiptClientSide
//
// Verbotene Storage-Keys:
//   - mobile_access
//   - course_unlocked
//   - iap_entitlement
//   - local_entitlement
export {};
`;
}

function safeStr(v: unknown, fb = ""): string {
  return typeof v === "string" && v.trim().length > 0 ? v : fb;
}

function buildPlayListing(m: Manifest, c: { title: string; description: string | null }, lang: "de" | "en") {
  const l = (lang === "de" ? m.store_listing_de : m.store_listing_en) || {};
  const isDe = lang === "de";
  const shortDe = `Prüfungsvorbereitung & Lernsystem für ${m.app_name}. Prüfungsnah, rahmenplanorientiert.`;
  const shortEn = `Exam preparation & learning system for ${m.app_name}. Practice-oriented, curriculum-aligned.`;
  const fullDe = `${m.app_name} ist ein digitales Vorbereitungssystem auf die Abschlussprüfung. Inhalte orientieren sich am Rahmenlehrplan und decken Lernfelder, prüfungsnahe Aufgaben, Mini-Checks sowie ein mündliches Fachgespräch ab.

Wichtig: ${m.app_name} ist KEIN offizieller Prüfungsträger und KEINE offizielle IHK-App. Die App unterstützt bei der Vorbereitung auf die Prüfung; die Prüfungsabnahme erfolgt ausschließlich durch die zuständigen Kammern und Stellen.

Funktionen:
• Prüfungssimulation mit auswertbarer Rückmeldung
• Lernkarten und Mini-Checks pro Lernfeld
• Mündliches Fachgespräch als Übungsmodus
• Adaptiver Lernpfad nach Fortschritt
• Offline-fähige Inhalte nach erstmaligem Laden

CTA: "Prüfung simulieren"

Support: ${m.support_url}
Datenschutz: ${m.privacy_url}
`;
  const fullEn = `${m.app_name} is a digital exam preparation system. Content follows the official training framework and covers learning fields, exam-style tasks, mini-checks and an oral exam practice mode.

Important: ${m.app_name} is NOT an official examiner and NOT an official chamber app. The app supports your preparation; the examination itself is conducted only by the responsible chambers.

Features:
• Exam simulation with feedback
• Learning cards and mini-checks per field
• Oral exam practice
• Adaptive learning path
• Offline-capable content after first load

CTA: "Run exam simulation"

Support: ${m.support_url}
Privacy: ${m.privacy_url}
`;
  return {
    language: isDe ? "de-DE" : "en-US",
    title: safeStr((l as any).title, m.app_name),
    short_description: safeStr((l as any).short_description, isDe ? shortDe : shortEn),
    full_description: safeStr((l as any).full_description, isDe ? fullDe : fullEn),
    feature_graphic_copy: safeStr((l as any).feature_graphic_copy,
      isDe ? `${m.app_name} — Prüfung simulieren, sicher bestehen.` : `${m.app_name} — simulate the exam, pass with confidence.`),
    screenshot_captions: (l as any).screenshot_captions || (isDe
      ? ["Adaptiver Lernpfad", "Prüfungssimulation", "Mini-Checks", "Mündliches Fachgespräch"]
      : ["Adaptive learning path", "Exam simulation", "Mini-checks", "Oral exam practice"]),
    category: m.category,
    content_rating: "Everyone",
    contact_email: m.contact_email,
    contact_website: m.marketing_url,
    privacy_policy: m.privacy_url,
    support_url: m.support_url,
    marketing_url: m.marketing_url,
    contains_ads: false,
    in_app_purchases: !!m.android_iap_product_id,
    course_reference: { title: c.title, course_id: m.course_id, curriculum_id: m.curriculum_id },
  };
}

function buildAppStoreListing(m: Manifest, c: { title: string; description: string | null }, lang: "de" | "en") {
  const l = (lang === "de" ? m.store_listing_de : m.store_listing_en) || {};
  const isDe = lang === "de";
  const subtitleDe = "Prüfungsnahe Vorbereitung";
  const subtitleEn = "Practice-oriented exam prep";
  const promoDe = `Vorbereitung auf die Abschlussprüfung in ${m.app_name}. Rahmenplanorientiert. Kein offizieller Prüfungsträger.`;
  const promoEn = `Exam preparation for ${m.app_name}. Curriculum-aligned. Not an official examiner.`;
  return {
    locale: isDe ? "de-DE" : "en-US",
    name: safeStr((l as any).title, m.app_name),
    subtitle: safeStr((l as any).subtitle, isDe ? subtitleDe : subtitleEn),
    promotional_text: safeStr((l as any).promotional_text, isDe ? promoDe : promoEn),
    description: safeStr((l as any).full_description,
      isDe
        ? `${m.app_name} ist ein digitales Vorbereitungssystem auf die Abschlussprüfung. Rahmenplanorientiert, mit Prüfungssimulation, Mini-Checks und mündlichem Fachgespräch.\n\nHinweis: KEINE offizielle IHK-App und KEIN offizieller Prüfungsträger. Die App unterstützt deine Vorbereitung. CTA: "Prüfung starten".`
        : `${m.app_name} is a digital exam preparation system. Curriculum-aligned, with exam simulation, mini-checks and oral practice.\n\nNote: NOT an official examiner app. The app supports your preparation. CTA: "Start exam".`),
    keywords: safeStr((l as any).keywords, isDe ? "Prüfung, Vorbereitung, Lernen, KI-Tutor, Rahmenplan" : "exam, preparation, learning, tutor, curriculum"),
    primary_category: m.category,
    secondary_category: "REFERENCE",
    age_rating: m.age_rating_hint,
    support_url: m.support_url,
    marketing_url: m.marketing_url,
    privacy_policy_url: m.privacy_url,
    copyright: `© ${new Date().getFullYear()} ${m.copyright_holder}`,
    contains_iap: !!m.ios_iap_product_id,
    course_reference: { title: c.title, course_id: m.course_id, curriculum_id: m.curriculum_id },
  };
}

function buildCopyright(m: Manifest, c: { title: string; slug: string }): string {
  const y = new Date().getFullYear();
  return `# Copyright & Lizenz

**Kurs:** ${c.title}
**Slug:** ${c.slug}
**Bundle:** ${m.bundle_id}

© ${y} ${m.copyright_holder}. Alle Rechte vorbehalten.

${m.license_text || ""}

## Verwendete Open-Source-Komponenten

Diese App nutzt Capacitor (MIT) sowie weitere Open-Source-Bibliotheken — siehe \`package.json\`.
Die jeweiligen Lizenztexte werden in der App unter „Über → Lizenzen" angezeigt.
`;
}

function buildReadme(m: Manifest, c: { title: string }): string {
  return `# ${m.app_name}

Mobile App für Kurs **${c.title}** (Bundle: \`${m.bundle_id}\`, Version ${m.version_name}, Build ${m.build_number}).

Generiert von ExamFit Mobile Course Package Builder — MOBILE.COURSE.PACKAGE.OS.1 · Phase C.

## SSOT-Garantie

- Kursinhalte werden **nicht** dupliziert (siehe \`SSOT_NOTES.md\`).
- IAP-Receipts werden ausschließlich serverseitig über \`validate-iap-receipt\` validiert (siehe \`IAP_NOTES.md\`).
- Kein lokaler Unlock, keine Service-Keys im Bundle (siehe \`NO_SECRETS.md\`).

Vor Release bitte \`RELEASE_CHECKLIST.md\` durchlaufen.
`;
}

function buildReleaseChecklist(m: Manifest, c: { title: string }): string {
  return `# Release Checklist — ${m.app_name} (${m.bundle_id})

Kurs: ${c.title}
Version: ${m.version_name} · Build ${m.build_number}

## Manifest & Identität
- [ ] Manifest vollständig (bundle_id, app_name, version_name, build_number, locales)
- [ ] iOS & Android Bundle IDs eindeutig im jeweiligen Store
- [ ] Store SKUs gepflegt (ios_iap_product_id, android_iap_product_id)
- [ ] Course / Curriculum / Product Referenz im Manifest gesetzt

## IAP & Access (SSOT)
- [ ] IAP Smoke aus Phase B.1 bestanden (\`/admin/tools/mobile-iap-smoke\`)
- [ ] IAP-Config verweist ausschließlich auf \`validate-iap-receipt\`
- [ ] Access-Read läuft über \`check_product_access_by_curriculum\`
- [ ] Keine lokalen Unlock-Flags im Bundle

## Content
- [ ] Aktueller Course-Export verfügbar (\`content_export_url\`)
- [ ] \`/admin/tools/bulk-course-export\` vor Build neu ausgeführt

## Store-Listing
- [ ] App Store Listing (DE/EN) geprüft
- [ ] Google Play Listing (DE/EN) geprüft
- [ ] Privacy URL gesetzt
- [ ] Support URL gesetzt
- [ ] Marketing URL gesetzt
- [ ] Review Notes übernommen
- [ ] Screenshots vollständig (siehe \`store/screenshots/required-sizes.json\`)
- [ ] Keine Behauptung "offizielle IHK-App"
- [ ] CTA: "Prüfung starten" / "Prüfung simulieren"

## Sicherheit
- [ ] Keine Secrets im ZIP
- [ ] Keine Service-Role-Keys
- [ ] Keine Admin-Routen im Mobile-Bundle
- [ ] Keine Raw-Receipts im Client gespeichert

## Bekannte Grenzen
- [ ] \`IAP.STATUS.LIFECYCLE\` (expired/refunded/cancelled) als bekannter Folgeblock dokumentiert — nicht in diesem Release.
`;
}

function buildReviewNotes(m: Manifest, c: { title: string }): string {
  return `# Review Notes (Apple / Google)

App: ${m.app_name}
Bundle: ${m.bundle_id}
Kurs: ${c.title}

## Was die App tut
${m.app_name} ist ein digitales Vorbereitungssystem auf die Abschlussprüfung im
Beruf "${c.title}". Inhalte sind rahmenplanorientiert. Die App führt
Prüfungssimulationen und Mini-Checks durch und bietet einen Übungsmodus für das
mündliche Fachgespräch.

## Was die App NICHT ist
- Kein offizieller Prüfungsträger.
- Keine offizielle Kammer-/IHK-App.
- Keine Markenverbindung zu offiziellen Stellen.

## In-App-Käufe
Digitale Inhalte werden über StoreKit (iOS) bzw. Play Billing (Android) freigeschaltet.
Receipts werden ausschließlich serverseitig validiert (\`validate-iap-receipt\`).
Es gibt keinen lokalen Unlock-Pfad.

## Test-Account
Bitte per Mail anfragen: ${m.contact_email}
`;
}

const PLAY_README = `# Google Play Console — Upload Checklist

1. Play Console → neue App erstellen mit applicationId aus capacitor.config.ts
2. Store-Eintrag: Texte/Screenshots aus diesem Ordner übernehmen
3. Datenerfassung: "App Data Safety" Form ausfüllen (siehe docs/iap-setup.md)
4. Releases → Production → \`app-release.aab\` hochladen (signiert via Play App Signing)
5. Inhaltsbewertung: Fragebogen ausfüllen (EDUCATION → Everyone)
6. Preisgestaltung: kostenlos mit In-App-Käufen (siehe iap.config.ts)
`;

const APP_STORE_README = `# App Store Connect — Upload Checklist

1. App Store Connect → My Apps → neue App mit iOS Bundle ID
2. App Information: Texte aus listing.de.json / listing.en.json
3. Pricing and Availability: Free mit IAP
4. In-App Purchases: ios_iap_product_id aus src/iap.config.ts anlegen
5. App Privacy: Privacy Manifest pflegen
6. Build hochladen: Xcode → Product → Archive → Distribute App → App Store Connect
   ODER Transporter mit signiertem .ipa
7. TestFlight für Beta-Test, dann „Submit for Review"
`;

const PRIVACY_README = `# Privacy Disclosures

Apple App Privacy Label und Google Play Data Safety müssen identisch zur
Online-Datenschutzerklärung sein. Quelle ist die hinterlegte privacy_url im
Manifest. Diese App speichert keine personenbezogenen Daten lokal über das
hinaus, was für Login und Lernfortschritt nötig ist. Receipt-Validierung
erfolgt serverseitig — Raw-Receipts werden nicht im Client persistiert.
`;

const SCREENSHOT_README = `# Screenshots Required

Lege Dateien hier ab: \`store/screenshots/{phone|tablet|dark|light}/01.png\` etc.
Pflichtgrößen siehe \`required-sizes.json\`.
`;

const REQUIRED_SCREENSHOT_SIZES = {
  ios: {
    "iphone_6_7": { width: 1290, height: 2796, min_count: 3, required: true },
    "iphone_6_5": { width: 1284, height: 2778, min_count: 3, required: true },
    "iphone_5_5": { width: 1242, height: 2208, min_count: 0, required: false },
    "ipad_12_9":  { width: 2048, height: 2732, min_count: 0, required: false },
  },
  android: {
    "phone":          { min_width: 320, aspect: "16:9..9:16", min_count: 2, required: true },
    "feature_graphic":{ width: 1024, height: 500, min_count: 1, required: true },
    "icon":           { width: 512, height: 512, min_count: 1, required: true },
    "tablet_7":       { min_count: 0, required: false },
    "tablet_10":      { min_count: 0, required: false },
  },
};

const SSOT_NOTES = `# SSOT Notes — Mobile Bundle

Single Source of Truth — diese App ist eine Distributions-Shell, nicht ein
zweites Backend.

1. **Content**: Kursinhalte werden zur Build-Zeit aus dem zentralen
   course-export ZIP geladen (signed URL). Keine Kurskopie im Bundle.
2. **Access (read)**: \`check_product_access_by_curriculum\` ist der einzige
   Lesepfad. Mobile-Hooks dürfen ausschließlich diesen RPC nutzen.
3. **Access (write)**: \`validate-iap-receipt\` ist der einzige Schreibpfad.
   Er delegiert intern an \`verify-ios-receipt\` / \`verify-android-purchase\`,
   die \`store_receipts\` und \`create_store_entitlement\` nutzen.
4. **Listings**: Store-Texte kommen aus dem Manifest und werden deterministisch
   gerendert (siehe \`build-info.json.listing_hash\`).
5. **Identität**: Jede App referenziert eindeutig Course / Curriculum / Product
   (siehe \`src/course-manifest.json\`).
`;

const IAP_NOTES = `# IAP Notes — Mobile Bundle

- Validierungs-Endpoint: \`validate-iap-receipt\` (Phase B Dispatcher).
- Dispatch-Ziele: \`verify-ios-receipt\` und \`verify-android-purchase\`.
- Entitlement-Schreiben: nur via \`create_store_entitlement\` RPC.
- Cache-Invalidations-Keys: product-access, product-access-by-curriculum,
  product-access-curriculum, entitlements, course-access, learner-course-grants.
- Bekannte Grenze: \`IAP.STATUS.LIFECYCLE\` (expired/refunded/cancelled) ist
  noch nicht implementiert — siehe \`KNOWN_LIMITATIONS.md\`.
`;

const NO_SECRETS = `# NO_SECRETS Policy

Dieses Bundle enthält keine Secrets. Insbesondere:

- KEIN SUPABASE_SERVICE_ROLE_KEY
- KEIN STRIPE_SECRET_KEY (sk_live / sk_test)
- KEIN OPENAI_API_KEY
- KEIN APP_STORE_CONNECT_KEY
- KEIN GOOGLE_PLAY_SERVICE_ACCOUNT
- KEIN GOOGLE_APPLICATION_CREDENTIALS
- KEINE PRIVATE KEYS

Alle Signing-Secrets gehören in CI-Secrets oder in lokale Keychains, niemals in
das versionierte Mobile-Source-Bundle.
`;

const KNOWN_LIMITATIONS = `# Known Limitations

- \`IAP.STATUS.LIFECYCLE\`: Refund-, Expiry- und Cancellation-Webhooks von
  Apple/Google werden in einem separaten Cut behandelt. Der aktuelle Pfad
  validiert Receipts beim Kauf und schreibt Entitlements; rückwärtige
  Statuswechsel werden noch nicht synchronisiert.
- Reines Source-Bundle: finaler Build und Signierung laufen extern
  (GitHub Actions oder lokale Toolchain).
`;

const ANDROID_WORKFLOW = `name: Android Release Build

on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '17' }
      - run: npm ci
      - name: Download course content
        run: |
          CONTENT_URL=$(jq -r '.content_export_url' src/course-manifest.json)
          curl -sSL "$CONTENT_URL" -o course.zip
          mkdir -p assets/course && unzip -q course.zip -d assets/course
      - run: npm run build
      - run: npx cap add android || true
      - run: npx cap sync android
      - name: Decode keystore
        run: echo "\${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/app/release.keystore
      - name: Build AAB
        env:
          KEYSTORE_PASSWORD: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: \${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASSWORD: \${{ secrets.ANDROID_KEY_PASSWORD }}
        run: cd android && ./gradlew bundleRelease
      - uses: actions/upload-artifact@v4
        with:
          name: app-release-aab
          path: android/app/build/outputs/bundle/release/app-release.aab
`;

const IOS_WORKFLOW = `name: iOS Release Build

on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Download course content
        run: |
          CONTENT_URL=$(jq -r '.content_export_url' src/course-manifest.json)
          curl -sSL "$CONTENT_URL" -o course.zip
          mkdir -p assets/course && unzip -q course.zip -d assets/course
      - run: npm run build
      - run: npx cap add ios || true
      - run: npx cap sync ios
      - name: Install certs & profiles
        uses: apple-actions/import-codesign-certs@v3
        with:
          p12-file-base64: \${{ secrets.APPLE_CERT_P12_BASE64 }}
          p12-password: \${{ secrets.APPLE_CERT_PASSWORD }}
      - uses: apple-actions/download-provisioning-profiles@v3
        with:
          bundle-id: \${{ secrets.APPLE_BUNDLE_ID }}
          issuer-id: \${{ secrets.APPLE_ISSUER_ID }}
          api-key-id: \${{ secrets.APPLE_API_KEY_ID }}
          api-private-key: \${{ secrets.APPLE_API_PRIVATE_KEY }}
      - name: Archive & Upload
        run: |
          cd ios/App
          xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -archivePath build/App.xcarchive archive
          xcodebuild -exportArchive -archivePath build/App.xcarchive -exportPath build -exportOptionsPlist ../../docs/ExportOptions.plist
          xcrun altool --upload-app -f build/App.ipa -t ios --apiKey \${{ secrets.APPLE_API_KEY_ID }} --apiIssuer \${{ secrets.APPLE_ISSUER_ID }}
`;

const PACKAGE_CHECK_WORKFLOW = `name: Mobile Package Check

on:
  pull_request:
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Forbid secrets in repo
        run: |
          set -e
          ! grep -rEn "service_role|sk_live|sk_test|APP_STORE_CONNECT|GOOGLE_APPLICATION_CREDENTIALS|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY" \\
            --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yml' --include='*.md' \\
            -- . || (echo "Forbidden secret-like token found" && exit 1)
      - name: Forbid admin routes
        run: |
          set -e
          ! grep -rEn "/admin/tools/mobile-iap-smoke|/admin/tools|/admin(/|\\")" \\
            --include='*.ts' --include='*.tsx' src || (echo "Admin route reference found in mobile bundle" && exit 1)
      - name: Forbid local unlock shadows
        run: |
          set -e
          ! grep -rEn "grantMobileAccess|unlockCourseLocally|createMobileEntitlement|validateReceiptClientSide|mobile_access|course_unlocked|iap_entitlement|local_entitlement" \\
            --include='*.ts' --include='*.tsx' src || (echo "Shadow access identifier found" && exit 1)
      - name: Require IAP SSOT references
        run: |
          set -e
          grep -q "validate-iap-receipt" src/iap.config.ts
          grep -q "check_product_access_by_curriculum" src/iap.config.ts
`;

const LOCAL_BUILD_DOCS = `# Lokaler Build (Mac mit Xcode + Android Studio)

## Vorbereitung
\`\`\`bash
npm install
CONTENT_URL=$(jq -r '.content_export_url' src/course-manifest.json)
curl -sSL "$CONTENT_URL" -o course.zip && mkdir -p assets/course && unzip course.zip -d assets/course
npm run build
\`\`\`

## Android (.aab für Play Store)
\`\`\`bash
npx cap add android
npx cap sync android
cd android
./gradlew bundleRelease
# Output: app/build/outputs/bundle/release/app-release.aab
\`\`\`

## iOS (Archive für App Store)
\`\`\`bash
npx cap add ios
npx cap sync ios
open ios/App/App.xcworkspace
# In Xcode: Product → Archive → Distribute App → App Store Connect
\`\`\`
`;

const SIGNING_DOCS = `# Signierung

## Android Keystore (einmalig pro App)
\`\`\`bash
keytool -genkey -v -keystore release.keystore -alias upload \\
  -keyalg RSA -keysize 2048 -validity 10000
\`\`\`
Dann \`base64 release.keystore | pbcopy\` → in GitHub Secret \`ANDROID_KEYSTORE_BASE64\` einfügen.
Weitere Secrets: \`ANDROID_KEYSTORE_PASSWORD\`, \`ANDROID_KEY_ALIAS\`, \`ANDROID_KEY_PASSWORD\`.

## Apple Code Signing
1. Apple Developer Account → Certificates → "Apple Distribution" erstellen
2. Provisioning Profile (App Store) erstellen für deine Bundle ID
3. Zertifikat als .p12 exportieren, \`base64 cert.p12\` → Secret \`APPLE_CERT_P12_BASE64\`
4. App Store Connect API Key erstellen → Secrets \`APPLE_API_KEY_ID\`, \`APPLE_ISSUER_ID\`, \`APPLE_API_PRIVATE_KEY\`
`;

const IAP_DOCS = `# In-App-Purchases (Pflicht für digitale Kursinhalte)

## Warum IAP statt Stripe?
- **Apple App Store:** Verpflichtend für digitale Inhalte
- **Google Play:** Verpflichtend laut Play Billing Policy
- **Web (berufos.com):** Stripe bleibt, 24,90 € einmalig

## Setup Apple StoreKit
1. App Store Connect → My Apps → In-App Purchases → \`+\`
2. Type: "Non-Consumable" (Lifetime-Lizenz)
3. Product ID: muss exakt mit \`ios_iap_product_id\` im Manifest übereinstimmen

## Setup Google Play Billing
1. Play Console → Monetisierung → In-App-Produkte → Erstellen
2. Product ID: \`android_iap_product_id\` aus Manifest

## Receipt Validation
Receipts werden ausschließlich serverseitig über \`validate-iap-receipt\` validiert
(Phase B Dispatcher → verify-ios-receipt / verify-android-purchase).
`;
