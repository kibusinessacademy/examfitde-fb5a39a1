// MOBILE.COURSE.PACKAGE.OS.1 — Phase A
// Builds a per-course Capacitor mobile source bundle ZIP for App Store / Play Store distribution.
// SSOT-GUARD: Inhalte werden NICHT dupliziert — Bundle referenziert nur den existierenden
// course-export ZIP via signed URL. Diese Function liefert ausschließlich die Mobile-Shell
// (Capacitor-Config, CI-Workflows, Store-Metadaten, Lizenz, README).
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
  bundle_id: string;
  app_name: string;
  short_name: string;
  version_name: string;
  version_code: number;
  primary_color: string;
  icon_url: string | null;
  feature_graphic_url: string | null;
  ios_iap_product_id: string | null;
  android_iap_product_id: string | null;
  iap_price_tier: string | null;
  store_listing_de: Record<string, unknown>;
  store_listing_en: Record<string, unknown>;
  copyright_holder: string;
  license_text: string;
  privacy_url: string;
  imprint_url: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // Authn
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    // Authz: admin only
    const sb = createClient(url, service);
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const courseId = String(body?.course_id || "");
    if (!courseId) return json({ error: "course_id required" }, 400);

    // Load manifest
    const { data: m, error: mErr } = await sb
      .from("mobile_course_app_manifest")
      .select("*")
      .eq("course_id", courseId)
      .maybeSingle();
    if (mErr) return json({ error: mErr.message }, 500);
    if (!m) return json({ error: "manifest not configured for course — create one first" }, 404);

    const manifest = m as Manifest;

    // Load course basics (no content duplication — only metadata)
    const { data: course, error: cErr } = await sb
      .from("courses")
      .select("id, title, slug, description, status, visibility")
      .eq("id", courseId)
      .maybeSingle();
    if (cErr || !course) return json({ error: "course not found" }, 404);

    // Mark building
    await sb.from("mobile_course_app_manifest")
      .update({ last_build_status: "building", last_build_error: null })
      .eq("course_id", courseId);

    // Find existing course-content export URL (SSOT — no duplication)
    const { data: existingExport } = await sb
      .from("course_package_outputs")
      .select("payload, last_exported_at")
      .eq("output_key", "export_zip_with_player")
      .order("last_exported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contentExportUrl = (existingExport?.payload as any)?.downloadUrl || null;

    // ── Build the Capacitor source bundle ──
    const zip = new JSZip();
    const safeBundle = manifest.bundle_id.replace(/\./g, "-");

    // 1. README
    zip.file("README.md", buildReadme(manifest, course));

    // 2. capacitor.config.ts (per-course identity)
    zip.file("capacitor.config.ts", buildCapacitorConfig(manifest));

    // 3. package.json
    zip.file("package.json", buildPackageJson(manifest));

    // 4. Course manifest (DB-driven, no content duplication)
    zip.file("src/course-manifest.json", JSON.stringify({
      course_id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      bundle_id: manifest.bundle_id,
      version: { name: manifest.version_name, code: manifest.version_code },
      content_export_url: contentExportUrl,
      content_export_note: "Lade Kursinhalte zur Build-Zeit von dieser URL und packe sie in /assets/course/. URL ist 7 Tage gültig — vor jedem Release neu generieren via /admin/tools/bulk-course-export.",
      iap: {
        ios: manifest.ios_iap_product_id,
        android: manifest.android_iap_product_id,
        price_tier: manifest.iap_price_tier,
      },
      legal: {
        copyright_holder: manifest.copyright_holder,
        privacy_url: manifest.privacy_url,
        imprint_url: manifest.imprint_url,
      },
    }, null, 2));

    // 5. IAP config stub (Apple StoreKit + Google Play Billing)
    zip.file("src/iap.config.ts", buildIapConfig(manifest));

    // 6. Store metadata
    zip.file("store/google-play/listing.de.json", JSON.stringify(buildPlayListing(manifest, "de"), null, 2));
    zip.file("store/google-play/listing.en.json", JSON.stringify(buildPlayListing(manifest, "en"), null, 2));
    zip.file("store/google-play/README.md", PLAY_README);
    zip.file("store/app-store/listing.de.json", JSON.stringify(buildAppStoreListing(manifest, "de"), null, 2));
    zip.file("store/app-store/listing.en.json", JSON.stringify(buildAppStoreListing(manifest, "en"), null, 2));
    zip.file("store/app-store/README.md", APP_STORE_README);
    zip.file("store/screenshots/README.md", SCREENSHOT_README);

    // 7. Legal
    zip.file("LICENSE.txt", `Copyright © ${new Date().getFullYear()} ${manifest.copyright_holder}\nAll rights reserved.\n\n${manifest.license_text}`);
    zip.file("COPYRIGHT.md", buildCopyright(manifest, course));
    zip.file("PRIVACY.md", `# Datenschutz\n\nDie vollständige Datenschutzerklärung ist online verfügbar:\n${manifest.privacy_url}\n`);
    zip.file("IMPRINT.md", `# Impressum\n\n${manifest.imprint_url}\n`);

    // 8. CI Workflows
    zip.file(".github/workflows/android-release.yml", ANDROID_WORKFLOW);
    zip.file(".github/workflows/ios-release.yml", IOS_WORKFLOW);

    // 9. .gitignore + .nvmrc
    zip.file(".gitignore", "node_modules/\ndist/\nandroid/app/release/\nios/App/build/\n*.keystore\n*.jks\n.env\n.env.local\n");
    zip.file(".nvmrc", "20\n");

    // 10. Build instructions
    zip.file("docs/local-build.md", LOCAL_BUILD_DOCS);
    zip.file("docs/signing.md", SIGNING_DOCS);
    zip.file("docs/iap-setup.md", IAP_DOCS);

    const bytes = await zip.generateAsync({ type: "uint8array" });

    // Upload
    const bucket = "course-exports";
    const path = `mobile-bundles/${safeBundle}/v${manifest.version_name}-${Date.now()}.zip`;
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
      last_built_at: new Date().toISOString(),
      last_build_status: "ready",
      last_build_output_url: signed?.signedUrl || null,
      last_build_error: null,
    }).eq("course_id", courseId);

    return json({
      ok: true,
      downloadUrl: signed?.signedUrl,
      fileSize: bytes.length,
      bundle_id: manifest.bundle_id,
      version: `${manifest.version_name} (${manifest.version_code})`,
      contains: {
        capacitor_config: true,
        ci_workflows: ["android-release.yml", "ios-release.yml"],
        store_metadata: ["google-play", "app-store"],
        iap_stub: true,
        legal: ["LICENSE.txt", "COPYRIGHT.md", "PRIVACY.md", "IMPRINT.md"],
        content_export_url: contentExportUrl,
        content_export_warning: contentExportUrl ? null : "Kein Kurs-Content-Export gefunden. Bitte zuerst /admin/tools/bulk-course-export ausführen.",
      },
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

function buildCapacitorConfig(m: Manifest): string {
  return `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${m.bundle_id}',
  appName: '${m.app_name}',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: '${m.short_name}',
    backgroundColor: '${m.primary_color}'
  },
  android: {
    backgroundColor: '${m.primary_color}',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
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

function buildIapConfig(m: Manifest): string {
  return `// IAP Configuration — Apple StoreKit + Google Play Billing
// SSOT: Stripe-Preis (Web) bleibt 24,90 €. IAP-Produkt-IDs müssen separat in
// App Store Connect & Google Play Console gepflegt sein.
export const IAP_PRODUCTS = {
  ios:     ${JSON.stringify(m.ios_iap_product_id || `TODO_IOS_${m.bundle_id}`)},
  android: ${JSON.stringify(m.android_iap_product_id || `TODO_ANDROID_${m.bundle_id}`)},
  priceTier: ${JSON.stringify(m.iap_price_tier || "tier_24_90_eur")},
} as const;

// Validate purchase server-side via your /functions/v1/validate-iap-receipt endpoint
export const RECEIPT_VALIDATION_URL = "https://berufos.com/functions/v1/validate-iap-receipt";
`;
}

function buildPlayListing(m: Manifest, lang: "de" | "en"): Record<string, unknown> {
  const l = (lang === "de" ? m.store_listing_de : m.store_listing_en) || {};
  return {
    language: lang === "de" ? "de-DE" : "en-US",
    title: (l as any).title || m.app_name,
    short_description: (l as any).short_description || (lang === "de" ? "Prüfungsvorbereitung mit KI-Tutor" : "Exam prep with AI tutor"),
    full_description: (l as any).full_description || "",
    category: "EDUCATION",
    content_rating: "Everyone",
    contact_email: "support@berufos.com",
    contact_website: "https://berufos.com",
    privacy_policy: m.privacy_url,
    contains_ads: false,
    in_app_purchases: !!m.android_iap_product_id,
  };
}

function buildAppStoreListing(m: Manifest, lang: "de" | "en"): Record<string, unknown> {
  const l = (lang === "de" ? m.store_listing_de : m.store_listing_en) || {};
  return {
    locale: lang === "de" ? "de-DE" : "en-US",
    name: (l as any).title || m.app_name,
    subtitle: (l as any).subtitle || "",
    description: (l as any).full_description || "",
    keywords: (l as any).keywords || "Prüfung, IHK, Lernen, KI-Tutor, Berufsschule",
    primary_category: "EDUCATION",
    secondary_category: "REFERENCE",
    age_rating: "4+",
    support_url: "https://berufos.com/support",
    marketing_url: "https://berufos.com",
    privacy_policy_url: m.privacy_url,
    copyright: `© ${new Date().getFullYear()} ${m.copyright_holder}`,
    contains_iap: !!m.ios_iap_product_id,
  };
}

function buildCopyright(m: Manifest, c: { title: string; slug: string }): string {
  const y = new Date().getFullYear();
  return `# Copyright & Lizenz

**Kurs:** ${c.title}  
**Slug:** ${c.slug}  
**Bundle:** ${m.bundle_id}

© ${y} ${m.copyright_holder}. Alle Rechte vorbehalten.

${m.license_text}

## Verwendete Open-Source-Komponenten

Diese App nutzt Capacitor (MIT) sowie weitere Open-Source-Bibliotheken — siehe \`package.json\`.
Die jeweiligen Lizenztexte werden in der App unter „Über → Lizenzen" angezeigt.
`;
}

function buildReadme(m: Manifest, c: { title: string }): string {
  return `# ${m.app_name}

Mobile App für Kurs **${c.title}** (Bundle: \`${m.bundle_id}\`, Version ${m.version_name}).

Generiert von ExamFit Mobile Course Package Builder — MOBILE.COURSE.PACKAGE.OS.1.

## Quickstart

\`\`\`bash
npm install
# Kursinhalt laden (siehe src/course-manifest.json → content_export_url)
npm run build
npx cap sync
\`\`\`

- **Android:** \`docs/local-build.md\` → Abschnitt Android
- **iOS:** \`docs/local-build.md\` → Abschnitt iOS  
- **Signierung:** \`docs/signing.md\`
- **In-App-Käufe:** \`docs/iap-setup.md\`

## Store-Pflichten

| Bereich | Apple App Store | Google Play |
|---|---|---|
| Digitale Inhalte | StoreKit IAP (Pflicht) | Play Billing (Pflicht) |
| Datenschutz | App-Privacy-Label | Data Safety Form |
| Altersfreigabe | 4+ | Everyone |
| Review-Dauer | ~24–48h | ~3–7 Tage |

## SSOT-Garantie

Kursinhalte werden **nicht** in dieses Repo dupliziert. Der Build-Schritt lädt sie
just-in-time vom Lovable Cloud Storage (signed URL, 7 Tage gültig). Vor jedem
Release: \`/admin/tools/bulk-course-export\` ausführen, dann \`/admin/tools/mobile-bundle-builder\`
neu bauen.
`;
}

const PLAY_README = `# Google Play Console — Upload Checklist

1. Play Console → neue App erstellen mit \`bundle_id\` aus listing.de.json
2. Store-Eintrag: Texte/Screenshots aus diesem Ordner übernehmen
3. Datenerfassung: "App Data Safety" Form ausfüllen (siehe docs/iap-setup.md)
4. Releases → Production → \`app-release.aab\` hochladen (signiert via Play App Signing)
5. Inhaltsbewertung: Fragebogen ausfüllen (EDUCATION → Everyone)
6. Preisgestaltung: kostenlos mit In-App-Käufen (siehe iap.config.ts)
`;

const APP_STORE_README = `# App Store Connect — Upload Checklist

1. App Store Connect → My Apps → neue App mit Bundle ID aus capacitor.config.ts
2. App Information: Texte aus listing.de.json / listing.en.json
3. Pricing and Availability: Free mit IAP
4. In-App Purchases: ios_iap_product_id aus src/iap.config.ts anlegen
5. App Privacy: Privacy Manifest pflegen
6. Build hochladen: Xcode → Product → Archive → Distribute App → App Store Connect
   ODER Transporter mit signiertem .ipa
7. TestFlight für Beta-Test, dann „Submit for Review"
`;

const SCREENSHOT_README = `# Screenshots Required

## iOS (App Store Connect, alle Pflicht)
- 6.7" (iPhone 15 Pro Max): 1290 × 2796 — mind. 3 Screenshots
- 6.5" (iPhone 14 Plus): 1284 × 2778 — mind. 3 Screenshots  
- 5.5" (iPhone 8 Plus): 1242 × 2208 — optional, aber empfohlen
- iPad Pro 12.9": 2048 × 2732 — Pflicht wenn iPad-Support aktiv

## Android (Google Play, Pflicht)
- Telefon: mind. 2 Screenshots, 16:9 bis 9:16, min 320px
- Feature-Grafik: 1024 × 500 (Pflicht)
- App-Icon: 512 × 512 PNG (Pflicht)
- 7" Tablet: 2 Screenshots (optional)
- 10" Tablet: 2 Screenshots (optional)

Lege Dateien hier ab: \`store/screenshots/{ios|android}/{device}/01.png\` etc.
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
- **Apple App Store:** Verpflichtend für digitale Inhalte (Reader-Ausnahme nur ohne Kauf-CTA in App)
- **Google Play:** Verpflichtend laut Play Billing Policy
- **Web (berufos.com):** Stripe bleibt, 24,90 € einmalig

## Setup Apple StoreKit
1. App Store Connect → My Apps → In-App Purchases → \`+\`
2. Type: "Non-Consumable" (Lifetime-Lizenz) oder "Auto-Renewable" (Jahres-Abo)
3. Product ID: muss exakt mit \`ios_iap_product_id\` in mobile_course_app_manifest übereinstimmen
4. Preis-Tier: empfohlen Tier 25 ≈ 24,99 € (Apple-Stufen erlauben kein exaktes 24,90)

## Setup Google Play Billing
1. Play Console → Monetisierung → In-App-Produkte → Erstellen
2. Product ID: \`android_iap_product_id\` aus Manifest
3. Preis: 24,90 € (Play erlaubt exakte Beträge)
4. Status: "Aktiv"

## Receipt Validation
Receipts MÜSSEN server-seitig validiert werden — niemals nur Client-Trust.
Endpoint: \`POST /functions/v1/validate-iap-receipt\` (separat zu implementieren, Phase B).
`;
