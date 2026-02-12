import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
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

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
    assertUuid("certification_id", p?.certification_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id;

  const unlockFail = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_handbook", p_status: "failed", p_log: { error: msg },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_handbook", p_status: "running",
      p_log: { note: "Creating SSOT handbook skeleton from curriculum_topics (no invention)" },
    });

    // Delete existing handbook for this curriculum (idempotent rebuild)
    const { data: existingChapters } = await sb
      .from("handbook_chapters").select("id").eq("curriculum_id", curriculumId);

    if (existingChapters?.length) {
      const chapterIds = existingChapters.map((x: { id: string }) => x.id);
      await sb.from("handbook_sections").delete().in("chapter_id", chapterIds);
      await sb.from("handbook_chapters").delete().eq("curriculum_id", curriculumId);
    }

    const { data: chapter, error: chErr } = await sb
      .from("handbook_chapters")
      .insert({ curriculum_id: curriculumId, title: "Handbuch: Prüfungsrelevante Themen", sort_order: 1 })
      .select("id").single();
    if (chErr) throw chErr;

    const { data: topics, error: tpErr } = await sb
      .from("curriculum_topics")
      .select("topic_name, description, weight_percentage")
      .eq("certification_id", certificationId)
      .order("weight_percentage", { ascending: false }).limit(50);
    if (tpErr) throw tpErr;

    let i = 1;
    for (const t of (topics || []) as Array<{ topic_name: string; description: string | null; weight_percentage: number | null }>) {
      await sb.from("handbook_sections").insert({
        chapter_id: chapter.id,
        title: String(t.topic_name || "Thema"),
        content_md: [
          `## ${t.topic_name || "Thema"}`, "",
          t.description ? String(t.description) : "_Beschreibung folgt (Council/LLM)._", "",
          `**Prüfungsgewichtung:** ${t.weight_percentage ?? 0}%`, "",
          "### Typische Prüfungsfallen",
          "_Wird durch Council + Blueprint-Analyse ergänzt._",
        ].join("\n"),
        sort_order: i++,
      });
    }

    await sb.from("course_package_outputs").upsert(
      {
        package_id: packageId, output_key: "handbook_status",
        payload: { curriculumId, chapterId: chapter.id, sections: (topics || []).length, mode: "skeleton_ssot" },
      },
      { onConflict: "package_id,output_key" }
    );

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_handbook", p_status: "done",
      p_log: { ok: true, sections: (topics || []).length },
    });
    await sb.from("course_packages").update({ build_progress: 88 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
