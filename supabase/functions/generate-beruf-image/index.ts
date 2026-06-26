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

function buildPrompt(title: string, kammer?: string | null): string {
  return [
    `Editorial documentary photograph of a young German apprentice (Auszubildende/r) actively working as "${title}" in an authentic German workplace.`,
    `The person wears realistic, profession-appropriate workwear or uniform for this specific trade.`,
    `Captured candidly mid-task with proper tools and real environment context (no posed studio look).`,
    `Soft natural daylight, shallow depth of field, 35mm lens look, cinematic color grade, magazine quality.`,
    `Hyper-realistic, photojournalism style, no text, no logos, no watermark, no collage, single subject focus.`,
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
    const prompt = buildPrompt(title, kammer);
    const b64 = await generateImageB64(prompt);
    const bytes = b64ToBytes(b64);
    const path = `${slug}.png`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "31536000",
    });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const image_url = pub.publicUrl;
    await sb.from("beruf_image_cache").upsert({
      slug,
      title,
      kammer,
      image_url,
      status: "ready",
      generated_at: new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
    });
    console.log(`[beruf-image] ready ${slug}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[beruf-image] fail ${slug}: ${msg}`);
    await sb.from("beruf_image_cache").upsert({
      slug,
      title,
      kammer,
      status: "failed",
      error: msg.slice(0, 500),
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

  let body: { items?: Array<{ slug: string; title: string; kammer?: string | null }> ; slug?: string; title?: string; kammer?: string | null };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const items = body.items?.length
    ? body.items
    : (body.slug && body.title ? [{ slug: body.slug, title: body.title, kammer: body.kammer ?? null }] : []);
  if (!items.length) return json({ error: "no items" }, 400);

  // Read current cache state
  const slugs = items.map((i) => i.slug);
  const { data: rows } = await sb
    .from("beruf_image_cache")
    .select("slug,status,image_url")
    .in("slug", slugs);
  const known = new Map((rows ?? []).map((r) => [r.slug, r]));

  // Queue missing or stale-failed
  const toGenerate = items.filter((it) => {
    const r = known.get(it.slug);
    if (!r) return true;
    if (r.status === "ready" && r.image_url) return false;
    if (r.status === "pending") return false;
    return r.status === "failed"; // retry failed
  });

  // Mark pending rows so concurrent calls don't double-trigger
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

  // Fire-and-forget background generation
  // @ts-ignore Deno EdgeRuntime global
  EdgeRuntime.waitUntil((async () => {
    // Sequential to avoid gateway rate-limits
    for (const it of toGenerate) {
      await generateAndStore(sb, it.slug, it.title, it.kammer ?? null);
    }
  })());

  return json({
    queued: toGenerate.map((i) => i.slug),
    cache: Object.fromEntries((rows ?? []).map((r) => [r.slug, r])),
  });
});
