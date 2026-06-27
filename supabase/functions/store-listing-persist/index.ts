// Store Listing Persist
// Generates store listing (via existing generate-store-listing function) AND
// persists a versioned, hash-keyed record into store_release_listings.
// Adds deterministic privacy_text / support_text templates per course.
//
// SSOT: store_release_listings is the single source of truth for store text content.
// Idempotent on (course_id, platform, locale, source_hash): same input → no new version.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderPrivacyText(opts: { appName: string; copyrightHolder: string; contactEmail: string }): string {
  const year = new Date().getFullYear();
  return `Datenschutzerklärung – ${opts.appName}

Stand: ${year}

Verantwortlich: ${opts.copyrightHolder}
Kontakt: ${opts.contactEmail}

1. Erhobene Daten
Die App erfasst zur Bereitstellung des Lernfortschritts: Account-ID, Lernfortschritt, Prüfungsergebnisse, Kursinhalte. Es werden keine Standortdaten und keine Werbe-IDs verarbeitet.

2. Zweck
Die Daten dienen ausschließlich der Bereitstellung der Lerninhalte, des Fortschritts und der Prüfungssimulation.

3. Rechtsgrundlage
Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) sowie Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an stabilem Betrieb).

4. Speicherort
Die Daten werden auf Servern in der EU gespeichert (Lovable Cloud / Supabase EU).

5. Drittanbieter
- Zahlungen: Apple App Store / Google Play (In-App-Käufe).
- Kein Tracking durch Werbenetzwerke. Kein Verkauf von Daten an Dritte.

6. Rechte
Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung und Datenübertragbarkeit. Kontakt: ${opts.contactEmail}.

7. Aufbewahrung
Account- und Lernfortschrittsdaten werden bis zur Kündigung oder auf Wunsch gelöscht.

© ${year} ${opts.copyrightHolder}`;
}

function renderSupportText(opts: { appName: string; contactEmail: string; supportUrl?: string }): string {
  return `Support – ${opts.appName}

Wir helfen schnell und persönlich.

Kontakt
• E-Mail: ${opts.contactEmail}
• Web: ${opts.supportUrl ?? "https://berufos.com/support"}
• Antwortzeit: in der Regel innerhalb von 24 Stunden (werktags).

Häufige Fragen
• Wie schalte ich gekaufte Inhalte auf einem zweiten Gerät frei? – Melde dich mit demselben Account an. Käufe sind kontogebunden, nicht gerätegebunden.
• Wie erhalte ich eine Rückerstattung? – Rückerstattungen erfolgen ausschließlich über Apple App Store bzw. Google Play.
• Ich finde meinen Kurs nicht. – Stelle sicher, dass du in der App mit dem Account eingeloggt bist, der den Kauf getätigt hat.

Datenschutz & Rechtliches
Siehe die Datenschutzerklärung in den App-Einstellungen.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const { courseId, platform, locale = "de", actorId = null } = body ?? {};

  if (!courseId || !platform || !["apple", "google"].includes(platform)) {
    return json({ error: "courseId and platform (apple|google) required" }, 400);
  }

  // Resolve manifest + package
  const { data: manifest } = await sb
    .from("mobile_course_app_manifest")
    .select("*")
    .eq("course_id", courseId)
    .maybeSingle();

  if (!manifest) return json({ error: "No mobile_course_app_manifest for course" }, 404);

  // Find a package for this course (needed by generate-store-listing)
  const { data: pkg } = await sb
    .from("course_packages")
    .select("id, course_id, curriculum_id, canonical_title, title")
    .eq("course_id", courseId)
    .limit(1)
    .maybeSingle();

  if (!pkg) return json({ error: "No course_package found for course" }, 404);

  // Invoke existing AI generator
  const store = platform; // 'apple' | 'google'
  const genResp = await fetch(`${SUPABASE_URL}/functions/v1/generate-store-listing`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
    },
    body: JSON.stringify({ packageId: (pkg as any).id, store }),
  });

  if (!genResp.ok) {
    const errText = await genResp.text();
    return json({ error: "generate-store-listing failed", details: errText }, 502);
  }
  const generated = await genResp.json();
  const listing = generated?.listing ?? generated ?? {};

  // Templated legal text (deterministic — not LLM)
  const copyrightHolder = (manifest as any).copyright_holder || "ExamFit.de";
  const contactEmail = (manifest as any).contact_email || "support@berufos.com";
  const appName = (manifest as any).app_name || (pkg as any).canonical_title || (pkg as any).title || "ExamFit";
  const supportUrl = (manifest as any).support_url || null;

  const privacy_text = renderPrivacyText({ appName, copyrightHolder, contactEmail });
  const support_text = renderSupportText({ appName, contactEmail, supportUrl });

  // Build a stable source hash from the inputs that materially affect the listing
  const hashInput = JSON.stringify({
    courseId, platform, locale,
    title: listing.title ?? null,
    subtitle: listing.subtitle ?? null,
    short_description: listing.short_description ?? listing.shortDescription ?? null,
    long_description: listing.long_description ?? listing.longDescription ?? null,
    keywords: listing.keywords ?? null,
    promo_text: listing.promo_text ?? listing.promoText ?? null,
    changelog: listing.changelog ?? null,
    privacy_text, support_text,
  });
  const source_hash = await sha256Hex(hashInput);

  // Idempotency: if latest row already has this hash, return it
  const { data: latest } = await sb
    .from("store_release_listings")
    .select("*")
    .eq("course_id", courseId)
    .eq("platform", platform)
    .eq("locale", locale)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && (latest as any).source_hash === source_hash) {
    return json({ ok: true, deduped: true, listing: latest });
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  // Mark previous as superseded
  if (latest) {
    await sb.from("store_release_listings")
      .update({ status: "superseded" })
      .eq("id", (latest as any).id)
      .in("status", ["draft", "review_ready"]);
  }

  const insertRow = {
    course_id: courseId,
    platform,
    locale,
    version: nextVersion,
    title: listing.title ?? null,
    subtitle: listing.subtitle ?? null,
    short_description: listing.short_description ?? listing.shortDescription ?? null,
    long_description: listing.long_description ?? listing.longDescription ?? null,
    keywords: listing.keywords ?? null,
    promo_text: listing.promo_text ?? listing.promoText ?? null,
    changelog: listing.changelog ?? null,
    privacy_text,
    support_text,
    source_hash,
    status: "review_ready",
    generated_by: actorId,
    raw_payload: generated,
  };

  const { data: inserted, error } = await sb
    .from("store_release_listings")
    .insert(insertRow)
    .select()
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, deduped: false, listing: inserted });
});
