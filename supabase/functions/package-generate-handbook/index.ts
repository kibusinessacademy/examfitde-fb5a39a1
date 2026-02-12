import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id;

  if (!packageId || !curriculumId || !certificationId) return json({ error: "Missing required fields" }, 400);

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "generate_handbook", p_status: "failed", p_log: { error: msg } });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
    }

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "generate_handbook", p_status: "running", p_log: { note: "Creating handbook skeleton (SSOT)" } });

    // Derive outline from curriculum_topics
    const { data: topics, error: tpErr } = await sb
      .from("curriculum_topics")
      .select("id, topic_name, description, weight_percentage")
      .eq("certification_id", certificationId)
      .order("weight_percentage", { ascending: false }).limit(40);
    if (tpErr) throw tpErr;

    const chapterTitle = "Handbuch: Prüfungsrelevante Themen";
    const { data: chapter, error: chErr } = await sb
      .from("handbook_chapters")
      .insert({ curriculum_id: curriculumId, title: chapterTitle, sort_order: 1 })
      .select("id").single();
    if (chErr) throw chErr;

    let i = 1;
    for (const t of (topics || []) as Array<{ topic_name?: string; description?: string; weight_percentage?: number }>) {
      await sb.from("handbook_sections").insert({
        chapter_id: chapter.id,
        title: String(t.topic_name || "Thema"),
        content_md: [
          `## ${t.topic_name}`, "",
          t.description ? String(t.description) : "_Beschreibung folgt (Council/LLM)._", "",
          `**Prüfungsgewichtung:** ${t.weight_percentage ?? 0}%`, "",
          "### Typische Prüfungsfallen",
          "_Wird durch Council + Blueprint-Analyse ergänzt._",
        ].join("\n"),
        sort_order: i++,
      });
    }

    await sb.from("course_package_outputs").upsert(
      { package_id: packageId, output_key: "handbook_status", payload: { chapterTitle, sections: (topics || []).length, mode: "skeleton_ssot" } },
      { onConflict: "package_id,output_key" }
    );

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "generate_handbook", p_status: "done", p_log: { ok: true, sections: (topics || []).length } });
    await sb.from("course_packages").update({ build_progress: 88 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
