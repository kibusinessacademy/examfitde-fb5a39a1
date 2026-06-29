import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const BUCKET = "beruf-images";
const MODEL = "google/gemini-3.1-flash-image";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

/**
 * Bump this whenever the prompt formula changes. Existing cache rows with a
 * lower `prompt_version` are automatically re-queued on the next request, so
 * authentic-Auszubildende refreshes propagate without a manual purge.
 */
const PROMPT_VERSION = 2;

type SceneSpec = {
  /** Stable scene identifier for analytics (never reuse / never rename). */
  id: string;
  /** Trade-specific subject + outfit, e.g. "young KFZ-Mechatroniker apprentice in dark blue overalls". */
  subject: string;
  /** Setting: where the apprentice works. */
  setting: string;
  /** Action / tool detail — what they are doing right now. */
  action: string;
  /** Short German noun phrase used in the alt-text ("Maurer-Auszubildender auf einer Baustelle"). */
  altRole: string;
  altScene: string;
};


/**
 * Map a course / Beruf title to a richer, profession-specific scene. The
 * rules are ordered specific → generic (same precedence as
 * src/lib/berufImage.ts). The first match wins.
 */
const SCENE_RULES: Array<[RegExp, SceneSpec]> = [
  // AEVO — trainer exam, not an apprentice exam
  [/(aevo|ausbildereignung|ada[-\s]?schein)/i, {
    subject: "confident German Ausbilderin (vocational trainer, mid-30s, business-casual smart attire) teaching three young apprentices (Auszubildende, mixed gender, workwear)",
    setting: "bright modern Ausbildungswerkstatt with workbenches, whiteboard with technical drawings, tools and learning materials",
    action: "explaining a process with engaged hand gestures while the apprentices listen attentively and take notes",
  }],

  // Finanz / Rechnungswesen
  [/(bilanzbuchhalt|steuerfachang|steuerberat|controller|finanzbuchhalt|buchhalt|wirtschaftspr)/i, {
    subject: "young German Auszubildende(r) zum Steuerfachangestellten in smart business attire",
    setting: "modern Steuerkanzlei office with dual monitors, paper ledgers and DATEV interface visible",
    action: "reviewing balance-sheet figures together with a senior colleague, pointing at numbers on screen",
  }],

  // IT / Software / Daten
  [/(informatik|fachinformat|systemintegrat|anwendungsentwick|software|cyber|daten|it[-\s])/i, {
    subject: "young German Fachinformatik-Auszubildende(r) in a relaxed dev-team hoodie",
    setting: "clean modern German IT workshop / serverraum with rack-units, patch panels, dual code monitors",
    action: "configuring a router or reviewing live code on screen with an experienced engineer beside them",
  }],

  // Elektronik / Elektrotechnik
  [/(elektronik|elektroniker|elektroanlag|mechatron(?!.*kfz)|automatis|systemelektronik)/i, {
    subject: "young Elektroniker-Auszubildende(r) in red workshop overalls and safety glasses",
    setting: "industrial Elektrowerkstatt with control cabinets, cable looms and a Fluke multimeter on the bench",
    action: "wiring a Schaltschrank with terminals while a journeyman checks the schematic on a clipboard",
  }],

  // KFZ / Fahrzeug
  [/(kfz|kraftfahrzeug|automobil|zweirad|karosserie|fahrzeuglackier|fahrzeuginterieur|land\-?und\-?baumaschin)/i, {
    subject: "young KFZ-Mechatroniker-Auszubildende(r) in dark blue overalls with grease-stained hands",
    setting: "professional German Autowerkstatt, car raised on a Hebebühne, diagnostic laptop on a rolling cart",
    action: "loosening a brake caliper with a torque wrench, fully focused on the task",
  }],

  // Verkehr / Transport
  [/(berufskraftfahr|eisenbahn|lokf(ü|u)hr|binnenschiff|fachkraft im fahrbetrieb|hafenlogist|kurier|post)/i, {
    subject: "young Berufskraftfahrer-Auszubildende(r) in hi-vis polo and cargo trousers",
    setting: "German Spedition yard with a Sattelzug truck cab open, route tablet in hand",
    action: "checking the pre-trip Abfahrtskontrolle alongside a mentor driver",
  }],

  // Logistik / Lager
  [/(lagerlogist|fachlagerist|logistikmeister|spedition|lager)/i, {
    subject: "young Fachkraft-für-Lagerlogistik-Auszubildende(r) in hi-vis vest and safety shoes",
    setting: "modern German distribution warehouse with high-bay racking and an electric Gabelstapler",
    action: "scanning a pallet barcode with a handheld terminal while a senior Lagerist verifies the order",
  }],

  // Energie / Umwelt
  [/(energieelektronik|photovoltaik|solarteur|windenerg|umwelttechn|wasserversorgung|abwasser)/i, {
    subject: "young Anlagenmechaniker-/Solarteur-Auszubildende(r) in technical workwear with safety harness",
    setting: "rooftop or PV-Freifläche with crystalline modules, inverters and cabling visible",
    action: "mounting a PV module on a rail-system under supervision, torque wrench in hand",
  }],

  // Chemie / Labor / Pharma
  [/(chemie|chemikant|chemielaborant|biologielaborant|pharmaz|lacklaborant)/i, {
    subject: "young Chemielaborant-Auszubildende(r) in white lab coat, safety goggles and nitrile gloves",
    setting: "spotless German chemistry lab with Abzug fume hood, Erlenmeyer flasks and a precision balance",
    action: "pipetting a sample into a volumetric flask while an Ausbilder takes notes on a protocol sheet",
  }],

  // Gesundheit / Pflege / Medizin
  [/(pfleg|gesund|medizin|kranken|arzt|zahn|apothek|altenpfleg|hebamm|optiker|orthop(ä|a)d|h(ö|o)rakustik|augenoptik)/i, {
    subject: "young Pflegefachfrau / Pflegefachmann-Auszubildende(r) in clean care-blue scrubs",
    setting: "warm, dignified room of a modern German Pflegeeinrichtung or Krankenhausstation",
    action: "talking gently with an elderly patient while documenting vitals on a tablet under guidance of a Praxisanleiterin",
  }],

  // Lebensmittel-Produktion
  [/(brauer|m(ä|a)lzer|fruchtsaft|lebensmitteltechn|milchwirt|milchtechn|s(ü|u)(ß|ss)warentechn|fleischer\-?fachverk)/i, {
    subject: "young Fachkraft-für-Lebensmitteltechnik-Auszubildende(r) in white hygiene smock, hairnet and food-safe gloves",
    setting: "stainless-steel German production line for a Lebensmittelbetrieb (e.g. Brauerei, Molkerei)",
    action: "monitoring a filling machine and noting quality readings on a clipboard with a Meister beside them",
  }],

  // Gastro / Küche / Hotel
  [/(koch|k(ö|o)ch|restaurant|hotel|gastro|b(ä|a)cker|konditor|fleisch|systemgastronom|fachkraft k(ü|u)che)/i, {
    subject: "young Koch- / Bäcker-Auszubildende(r) in classic white chef jacket and apron",
    setting: "professional German Profiküche or Backstube with stainless steel surfaces, induction hobs and copper pans",
    action: "plating a dish or shaping dough under the watchful eye of a Küchenchef / Bäckermeister",
  }],

  // Medien / Druck
  [/(mediengestal|drucker|medientechnolog|buchbinder|verlagskaufm|druck\-?und\-?medien)/i, {
    subject: "young Mediengestaltung-Digital-und-Print-Auszubildende(r) in casual creative wear",
    setting: "bright design studio with a calibrated 27 inch monitor, color charts and a Pantone fan on the desk",
    action: "refining a layout in Adobe InDesign while an Art Director gives feedback over their shoulder",
  }],

  // Holz / Tischler
  [/(tischler|schreiner|holzmech|holz\-?und\-?bautensch|bootsbau|b(ö|o)gen|bogenmacher)/i, {
    subject: "young Tischler-Auszubildende(r) in a sturdy Zunfthose and Lederschürze, fine wood dust on the sleeves",
    setting: "warmly lit traditional German Tischlerei with Hobelbank, hand planes and sawn oak boards",
    action: "checking a dovetail joint with a square while a Tischlermeister observes the workpiece",
  }],

  // Textil / Leder
  [/(textil|schneider|ma(ß|ss)schneider|leder|gerberei|polster|n(ä|a)her)/i, {
    subject: "young Maßschneider-Auszubildende(r) with a measuring tape around the neck and chalk in hand",
    setting: "atelier-style German Schneiderei with industrial Pfaff sewing machines, mannequins and fabric bolts",
    action: "marking a hem on a half-finished garment on a dress form, a Meisterin pinning seams alongside",
  }],

  // Sicherheit
  [/(schutz und sicherheit|werkschutz|sicherheitsfachkraft|wach\-?und\-?sicher)/i, {
    subject: "young Fachkraft-für-Schutz-und-Sicherheit-Auszubildende(r) in clean uniform with shoulder radio",
    setting: "modern Leitstelle / control room with CCTV monitor wall and access-control panel",
    action: "reviewing camera feeds and logging an incident with a senior officer at the console",
  }],

  // Tier / Zoo
  [/(tier|zoo|fisch|pferdew)/i, {
    subject: "young Tierpfleger-Auszubildende(r) in olive-green workwear and rubber boots",
    setting: "professional German animal facility (Tierheim, Zoo or Forschungseinrichtung) with clean enclosures",
    action: "gently handling or feeding an animal while a senior keeper supervises and explains care steps",
  }],

  // Garten / Landwirtschaft / Forst
  [/(garten|landschaft|forst|landwirt|g(ä|a)rtner|winzer|agrarservice)/i, {
    subject: "young Gärtner / Landwirt-Auszubildende(r) in earth-stained workwear and sturdy boots",
    setting: "open-air German Gärtnerei, Weinberg or Bauernhof with seasonal plants and tools visible",
    action: "pruning or planting alongside a Meister, hands in the soil, golden-hour sunlight",
  }],

  // Bau
  [/(maurer|zimmer|dachdeck|stra(ß|ss)enbau|beton|tiefbau|hochbau|ger(ü|u)st|asphalt|estrich|bodenleg|bauger(ä|a)t|bauzeichn|baustoff|brunnenbau|aufbereitungsmech|bergbau|fliesen)/i, {
    subject: "young Maurer / Zimmerer-Auszubildende(r) in dusty work trousers, helmet and hi-vis vest",
    setting: "real German Baustelle with scaffolding, formwork and a partly-built wall",
    action: "setting a brick with a Maurerkelle while a Polier checks alignment with a spirit level",
  }],

  // Metall / Industrie
  [/(metall|industriemech|werkzeugmech|zerspan|feinwerk|maschinen.*antrieb|chirurgiemech|b(ü|u)chsenmach|edelstein)/i, {
    subject: "young Industriemechaniker / Zerspanungsmechaniker-Auszubildende(r) in dark workshop trousers, safety glasses",
    setting: "industrial German Metall-Lehrwerkstatt with a CNC-Fräsmaschine, micrometers and steel swarf on the bed",
    action: "measuring a freshly turned shaft with a Bügelmessschraube while the Ausbilder checks the drawing",
  }],

  // Verkauf / Einzelhandel
  [/(verk(ä|a)ufer|einzelhandel|kaufm.*einzelhandel|drogist|buchh(ä|a)ndler|automatenfach|fachverk(ä|a)ufer)/i, {
    subject: "young Kaufmann/Kauffrau-im-Einzelhandel-Auszubildende(r) in tidy shop uniform with name badge",
    setting: "bright modern German retail store floor with well-stocked shelves and a POS terminal",
    action: "advising a real customer with a product in hand, a senior colleague nearby",
  }],

  // Dienstleistung / Beauty / Sport / Tourismus
  [/(friseur|kosmetik|stylist|fitness|sport|reise|tourismus|veranstaltungstechn|servicekraft)/i, {
    subject: "young Friseur / Tourismuskaufmann-Auszubildende(r) in stylish service-appropriate outfit",
    setting: "premium German salon, reception or event venue with warm task lighting",
    action: "serving a real client (cutting hair, advising a guest, briefing an event) under mentor supervision",
  }],

  // Kaufmännisch (generisch)
  [/(kaufm|kauffrau|kaufmann|b(ü|u)ro|industriekaufm|bank|versicher|immobilien|personal|marketing|management|betriebswirt|fachangestell)/i, {
    subject: "young Industriekaufmann/-frau-Auszubildende(r) in smart-casual business attire",
    setting: "modern open-plan German company office with daylight, plants and a real meeting going on in the background",
    action: "reviewing a spreadsheet on a laptop together with an experienced colleague at the desk",
  }],
];

function sceneFor(title: string, kammer: string | null): SceneSpec {
  for (const [re, spec] of SCENE_RULES) if (re.test(title)) return spec;
  // Generic fallback — still apprentice-led
  if (kammer === "HWK") {
    return {
      subject: `young German Handwerks-Auszubildende(r) (training as "${title}") in trade-appropriate workwear`,
      setting: "authentic German workshop matching the trade, real tools and materials visible",
      action: "actively working on a real task while a Meister guides the next step",
    };
  }
  return {
    subject: `young German Auszubildende(r) training as "${title}" in profession-appropriate workwear or uniform`,
    setting: "authentic German workplace that matches this specific occupation",
    action: "captured candidly mid-task with real tools, a senior colleague or Ausbilder nearby",
  };
}

function buildPrompt(_slug: string, title: string, kammer?: string | null): string {
  const scene = sceneFor(title, kammer ?? null);
  return [
    `Editorial documentary photograph for the German vocational training context.`,
    `Subject: ${scene.subject}.`,
    `Setting: ${scene.setting}.`,
    `Moment: ${scene.action}.`,
    `Always include at least one apprentice ("Auszubildende/r"); show a realistic mentor-apprentice scene where appropriate.`,
    `Soft natural daylight, shallow depth of field, 35mm lens look, cinematic color grade, magazine quality.`,
    `Hyper-realistic, photojournalism style. No text, no logos, no watermarks, no collage, no stock-photo posing.`,
    kammer ? `Context: ${kammer} occupation in Germany.` : "",
  ].filter(Boolean).join(" ");
}

async function generateImageB64(prompt: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("no b64_json in gateway response");
  return b64;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function generateAndStore(
  sb: ReturnType<typeof createClient>,
  slug: string,
  title: string,
  kammer: string | null,
) {
  try {
    const prompt = buildPrompt(slug, title, kammer);
    const b64 = await generateImageB64(prompt);
    const bytes = b64ToBytes(b64);
    const path = `${slug}.png`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "31536000",
    });
    if (upErr) throw upErr;
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signErr || !signed?.signedUrl) throw signErr ?? new Error("sign url failed");
    const image_url = signed.signedUrl;
    await sb.from("beruf_image_cache").upsert({
      slug,
      title,
      kammer,
      image_url,
      status: "ready",
      generated_at: new Date().toISOString(),
      error: null,
      prompt_version: PROMPT_VERSION,
      updated_at: new Date().toISOString(),
    });
    console.log(`[beruf-image] ready ${slug} v${PROMPT_VERSION}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[beruf-image] fail ${slug}: ${msg}`);
    await sb.from("beruf_image_cache").upsert({
      slug,
      title,
      kammer,
      status: "failed",
      error: msg.slice(0, 500),
      prompt_version: PROMPT_VERSION,
      updated_at: new Date().toISOString(),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: {
    items?: Array<{ slug: string; title: string; kammer?: string | null }>;
    slug?: string;
    title?: string;
    kammer?: string | null;
    force?: boolean;
  };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const items = body.items?.length
    ? body.items
    : (body.slug && body.title ? [{ slug: body.slug, title: body.title, kammer: body.kammer ?? null }] : []);
  if (!items.length) return json({ error: "no items" }, 400);

  const slugs = items.map((i) => i.slug);
  const { data: rows } = await sb
    .from("beruf_image_cache")
    .select("slug,status,image_url,prompt_version")
    .in("slug", slugs);
  const known = new Map((rows ?? []).map((r) => [r.slug, r]));

  const toGenerate = items.filter((it) => {
    if (body.force) return true;
    const r = known.get(it.slug) as { status: string; image_url: string | null; prompt_version: number | null } | undefined;
    if (!r) return true;
    if (r.status === "pending") return false;
    // Regenerate stale prompt versions even if image is "ready"
    if ((r.prompt_version ?? 1) < PROMPT_VERSION) return true;
    if (r.status === "ready" && r.image_url) return false;
    return true; // failed → retry
  });

  if (toGenerate.length) {
    await sb.from("beruf_image_cache").upsert(
      toGenerate.map((it) => ({
        slug: it.slug,
        title: it.title,
        kammer: it.kammer ?? null,
        status: "pending",
        updated_at: new Date().toISOString(),
      })),
    );
  }

  // @ts-ignore Deno EdgeRuntime global
  EdgeRuntime.waitUntil((async () => {
    for (const it of toGenerate) {
      await generateAndStore(sb, it.slug, it.title, it.kammer ?? null);
    }
  })());

  return json({
    prompt_version: PROMPT_VERSION,
    queued: toGenerate.map((i) => i.slug),
    cache: Object.fromEntries((rows ?? []).map((r) => [r.slug, r])),
  });
});
