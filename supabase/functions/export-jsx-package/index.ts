import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function safeFilename(name: string) {
  return name
    .replace(/[^a-z0-9\-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let { packageId, courseId } = await req.json().catch(() => ({} as Record<string, unknown>));

  // Resolve packageId from courseId if needed
  if (!packageId && courseId) {
    const { data: latestPkg } = await sb
      .from("course_packages")
      .select("id")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestPkg?.id) packageId = latestPkg.id;
  }

  if (!packageId) return json({ error: "packageId or courseId required" }, 400);

  try {
    // Load package
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("*")
      .eq("id", packageId)
      .single();
    if (pkgErr || !pkg) return json({ error: pkgErr?.message || "Package not found" }, 404);

    const cid = courseId || (pkg as Record<string, unknown>).course_id;
    if (!cid) return json({ error: "No course_id found" }, 400);

    // Load course
    const { data: course } = await sb
      .from("courses")
      .select("id, title, status, description, estimated_duration")
      .eq("id", cid)
      .maybeSingle();

    // Load modules
    const { data: modules } = await sb
      .from("modules")
      .select("id, title, sort_order, description")
      .eq("course_id", cid)
      .order("sort_order");

    // Load all lessons for each module
    const moduleIds = (modules || []).map((m: any) => m.id);
    const { data: allLessons } = moduleIds.length > 0
      ? await sb
          .from("lessons")
          .select("id, module_id, title, content, h5p_content_id, duration_minutes, sort_order, step, status, exam_block, minicheck_parsed")
          .in("module_id", moduleIds)
          .order("sort_order")
      : { data: [] };

    // Group lessons by module
    const lessonsByModule: Record<string, any[]> = {};
    for (const lesson of (allLessons || [])) {
      const mid = (lesson as any).module_id;
      if (!lessonsByModule[mid]) lessonsByModule[mid] = [];
      lessonsByModule[mid].push(lesson);
    }

    // Load handbook chapters (if curriculum exists)
    const planRes = await sb
      .from("course_package_plans")
      .select("plan")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const curriculumId = (planRes.data?.plan as any)?.curriculum_id;

    let handbookData: any[] = [];
    if (curriculumId) {
      const { data: chapters } = await sb
        .from("handbook_chapters")
        .select("id, title, sort_order")
        .eq("curriculum_id", curriculumId)
        .order("sort_order");

      for (const ch of (chapters || []) as any[]) {
        const { data: sections } = await sb
          .from("handbook_sections")
          .select("title, content_md, sort_order")
          .eq("chapter_id", ch.id)
          .order("sort_order");
        handbookData.push({ ...ch, sections: sections || [] });
      }
    }

    // Build JSX content pack structure
    const jsxPack = {
      meta: {
        exportType: "jsx-content-pack",
        exportedAt: new Date().toISOString(),
        packageId,
        courseId: cid,
        version: "1.0",
      },
      course: course || {},
      modules: (modules || []).map((m: any) => ({
        ...m,
        lessons: (lessonsByModule[m.id] || []).map((l: any) => ({
          id: l.id,
          title: l.title,
          sortOrder: l.sort_order,
          step: l.step,
          status: l.status,
          durationMinutes: l.duration_minutes,
          h5pContentId: l.h5p_content_id,
          content: l.content,
          examBlock: l.exam_block,
          minicheckParsed: l.minicheck_parsed,
        })),
      })),
      handbook: handbookData,
    };

    // Build ZIP with structured files
    const zip = new JSZip();
    
    // Main manifest
    zip.file("manifest.json", JSON.stringify(jsxPack.meta, null, 2));
    zip.file("course.json", JSON.stringify(jsxPack.course, null, 2));

    // Modules & lessons as individual files
    const modulesDir = zip.folder("modules");
    for (const mod of jsxPack.modules) {
      const moduleDir = modulesDir!.folder(safeFilename(mod.title || `module-${mod.sort_order}`));
      moduleDir!.file("module.json", JSON.stringify({ id: mod.id, title: mod.title, sortOrder: mod.sort_order, description: mod.description }, null, 2));
      
      for (const lesson of mod.lessons) {
        const lessonFile = safeFilename(lesson.title || `lesson-${lesson.sortOrder}`) + ".json";
        moduleDir!.file(lessonFile, JSON.stringify(lesson, null, 2));
      }
    }

    // Handbook
    if (handbookData.length > 0) {
      const hbDir = zip.folder("handbook");
      for (const ch of handbookData) {
        const chDir = hbDir!.folder(safeFilename(ch.title || `chapter-${ch.sort_order}`));
        for (const sec of ch.sections) {
          chDir!.file(safeFilename(sec.title || `section-${sec.sort_order}`) + ".md", sec.content_md || "");
        }
      }
    }

    // Full pack as single JSON for programmatic use
    zip.file("full-pack.json", JSON.stringify(jsxPack, null, 2));

    const bytes = await zip.generateAsync({ type: "uint8array" });

    // Upload to storage
    const bucket = "exports";
    const pkgTitle = safeFilename(String((pkg as Record<string, unknown>).title || packageId));
    const dateStr = new Date().toISOString().split("T")[0];
    const path = `jsx-packages/${packageId}/${pkgTitle}-jsx-${dateStr}.zip`;

    const { error: uploadErr } = await sb.storage
      .from(bucket)
      .upload(path, bytes, { contentType: "application/zip", upsert: true });
    if (uploadErr) return json({ error: `Upload failed: ${uploadErr.message}` }, 500);

    // Signed URL (1h)
    const { data: signed, error: signErr } = await sb.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    if (signErr) return json({ error: signErr.message }, 500);

    // Persist
    await sb.from("course_package_outputs").upsert(
      {
        package_id: packageId,
        output_key: "export_jsx",
        payload: {
          downloadUrl: signed.signedUrl,
          bucket,
          path,
          fileSize: bytes.length,
          created_at: new Date().toISOString(),
        },
      },
      { onConflict: "package_id,output_key" }
    );

    return json({
      ok: true,
      downloadUrl: signed.signedUrl,
      fileName: path,
      fileSize: bytes.length,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[export-jsx-package] Error:", message);
    return json({ error: message }, 500);
  }
});
