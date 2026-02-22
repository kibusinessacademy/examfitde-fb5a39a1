import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function clampStr(s: unknown, min: number, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length < min) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeEnum<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return (typeof v === "string" && (allowed as readonly string[]).includes(v)) ? (v as T) : def;
}

async function fingerprint(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const VALID_TYPES = [
  "CONTENT_ISSUE", "FEATURE_REQUEST", "BILLING_QUESTION",
  "LICENSE_QUESTION", "LEARNER_ACCOUNT_ISSUE", "DATA_CORRECTION", "TECHNICAL_ISSUE",
] as const;

const VALID_LINK_TYPES = [
  "INVOICE", "PAYMENT", "ORDER", "BILLING_ACCOUNT", "LEARNER",
  "LICENSE", "COMPANY", "CERTIFICATION", "LESSON", "QUESTION", "BLUEPRINT", "SEAT",
] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" });

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" });

    const body = await req.json().catch(() => ({}));

    const type = safeEnum(body.type, VALID_TYPES, "CONTENT_ISSUE");

    const title = clampStr(body.title, 4, 120);
    const message = clampStr(body.message, 10, 2000);
    if (!title || !message) return json(400, { error: "Invalid title/message (title: 4-120 chars, message: 10-2000 chars)" });

    const priority = safeEnum(body.priority, ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const, "MEDIUM");

    const certification_id = isUuid(body.certification_id) ? body.certification_id : null;
    const package_id = isUuid(body.package_id) ? body.package_id : null;
    const curriculum_id = isUuid(body.curriculum_id) ? body.curriculum_id : null;
    const competence_id = isUuid(body.competence_id) ? body.competence_id : null;
    const lesson_id = isUuid(body.lesson_id) ? body.lesson_id : null;
    const question_id = isUuid(body.question_id) ? body.question_id : null;
    const blueprint_id = isUuid(body.blueprint_id) ? body.blueprint_id : null;
    const page_path = typeof body.page_path === "string" ? body.page_path.slice(0, 300) : null;

    const attachment_urls = Array.isArray(body.attachment_urls)
      ? body.attachment_urls.filter((x: unknown) => typeof x === "string").slice(0, 5).map((x: string) => x.slice(0, 800))
      : [];

    // Parse ticket_links from body
    const rawLinks = Array.isArray(body.ticket_links) ? body.ticket_links.slice(0, 10) : [];
    const validLinks = rawLinks.filter((link: any) =>
      isUuid(link?.entity_id) &&
      typeof link?.entity_type === "string" &&
      (VALID_LINK_TYPES as readonly string[]).includes(link.entity_type)
    ).map((link: any) => ({
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      label: typeof link.label === "string" ? link.label.slice(0, 200) : null,
      meta: link.meta && typeof link.meta === "object" ? link.meta : {},
    }));

    // Sub-category (template selection)
    const sub_category = typeof body.sub_category === "string" ? body.sub_category.slice(0, 60) : null;

    const fpBase = [type, certification_id ?? "", lesson_id ?? "", question_id ?? "", title.toLowerCase(), message.toLowerCase().slice(0, 300)].join("|");
    const fp = await fingerprint(fpBase);

    // Prevent spam duplicates within 10 minutes
    const { data: recentDup } = await supabase
      .from("user_tickets")
      .select("id, created_at")
      .eq("created_by", userId)
      .eq("fingerprint", fp)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);

    if (recentDup && recentDup.length > 0) {
      return json(200, { ok: true, duplicate: true, ticket_id: recentDup[0].id });
    }

    const { data: inserted, error } = await supabase
      .from("user_tickets")
      .insert({
        type,
        status: "OPEN",
        priority,
        created_by: userId,
        certification_id,
        package_id,
        curriculum_id,
        competence_id,
        lesson_id,
        question_id,
        blueprint_id,
        page_path,
        source: "learner",
        title,
        message,
        attachment_urls,
        fingerprint: fp,
      })
      .select("id, type, status, priority, created_at")
      .maybeSingle();

    if (error) return json(500, { error: "insert_failed", details: error.message });

    // Insert ticket_links
    if (inserted && validLinks.length > 0) {
      const linksToInsert = validLinks.map((link: any) => ({
        ticket_id: inserted.id,
        entity_type: link.entity_type,
        entity_id: link.entity_id,
        label: link.label,
        meta: link.meta,
      }));

      await supabase.from("ticket_links").insert(linksToInsert);
    }

    return json(200, { ok: true, ticket: inserted, links_count: validLinks.length });
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as Error)?.message ?? e) });
  }
});
