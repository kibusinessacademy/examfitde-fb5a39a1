import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;

  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" }, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "Unknown error";
    const name = typeof body.name === "string" ? body.name.slice(0, 80) : null;
    const stack = typeof body.stack === "string" ? body.stack.slice(0, 4000) : null;
    const componentStack = typeof body.componentStack === "string" ? body.componentStack.slice(0, 2000) : null;
    const url = typeof body.url === "string" ? body.url.slice(0, 500) : null;
    const pathname = typeof body.pathname === "string" ? body.pathname.slice(0, 300) : null;
    const routePattern = typeof body.routePattern === "string" ? body.routePattern.slice(0, 200) : null;
    const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 300) : null;
    const errorId = typeof body.errorId === "string" ? body.errorId.slice(0, 60) : null;
    const courseId = typeof body.courseId === "string" ? body.courseId.slice(0, 60) : null;
    const packageId = typeof body.packageId === "string" ? body.packageId.slice(0, 60) : null;
    const lessonId = typeof body.lessonId === "string" ? body.lessonId.slice(0, 60) : null;
    const resourceSlug = typeof body.resourceSlug === "string" ? body.resourceSlug.slice(0, 120) : null;
    const viewport = body.viewport && typeof body.viewport === "object"
      ? { w: Number(body.viewport.w) || null, h: Number(body.viewport.h) || null }
      : null;
    const isChunkError = body.isChunkError === true;
    const userAgent = (typeof body.userAgent === "string" ? body.userAgent : req.headers.get("user-agent") ?? "").slice(0, 300) || null;
    const buildVersion = typeof body.buildVersion === "string" ? body.buildVersion.slice(0, 50) : null;
    const timestamp = typeof body.timestamp === "string" ? body.timestamp.slice(0, 40) : null;

    const severity = isChunkError ? "low" : "high";
    const category = isChunkError ? "chunk_error" : "runtime_error";

    const title = [
      "[Frontend]",
      name ? `${name}:` : null,
      message.slice(0, 100),
      routePattern ? `@ ${routePattern}` : null,
    ].filter(Boolean).join(" ").slice(0, 200);

    const { error } = await supabase.from("admin_notifications").insert({
      title,
      body: [
        errorId ? `ErrorID: ${errorId}` : null,
        pathname ? `Route: ${pathname}` : null,
        routePattern && routePattern !== pathname ? `Pattern: ${routePattern}` : null,
        courseId ? `CourseID: ${courseId}` : null,
        packageId ? `PackageID: ${packageId}` : null,
        lessonId ? `LessonID: ${lessonId}` : null,
        resourceSlug ? `Slug: ${resourceSlug}` : null,
        url ? `URL: ${url}` : null,
        referrer ? `Referrer: ${referrer}` : null,
        viewport ? `Viewport: ${viewport.w}x${viewport.h}` : null,
        stack ? `Stack:\n${stack.slice(0, 1500)}` : null,
        componentStack ? `Component:\n${componentStack.slice(0, 800)}` : null,
        userAgent ? `UA: ${userAgent.slice(0, 120)}` : null,
        buildVersion ? `Build: ${buildVersion}` : null,
      ].filter(Boolean).join("\n"),
      severity,
      category,
      entity_type: "frontend_error",
      entity_id: courseId ?? packageId ?? lessonId ?? null,
      metadata: {
        errorId,
        message,
        name,
        stack,
        componentStack,
        url,
        pathname,
        routePattern,
        courseId,
        packageId,
        lessonId,
        resourceSlug,
        referrer,
        viewport,
        isChunkError,
        userAgent,
        buildVersion,
        ts: timestamp ?? new Date().toISOString(),
      },
    });


    if (error) return json(500, { error: "insert_failed", details: error.message }, origin);
    return json(200, { ok: true }, origin);
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) }, origin);
  }
});
