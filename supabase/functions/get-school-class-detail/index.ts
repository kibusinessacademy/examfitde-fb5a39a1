import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, origin);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" }, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const url = new URL(req.url);
    const classId = url.searchParams.get("class_id");
    if (!classId) return json(400, { error: "class_id required" }, origin);

    // Get class with curriculum title
    const { data: cls, error: clsErr } = await supabase
      .from("school_classes")
      .select("id, org_id, name, curriculum_id, academic_year, grade_year, status, created_at")
      .eq("id", classId)
      .single();

    if (clsErr || !cls) return json(404, { error: "Class not found" }, origin);

    // Guard: user must have membership in the class's org
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", cls.org_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return json(403, { error: "No access" }, origin);

    const allowedRoles = ["OWNER", "MANAGER", "IT_ADMIN", "SCHOOL_ADMIN", "INSTRUCTOR"];
    if (!allowedRoles.includes(membership.role)) {
      return json(403, { error: "Insufficient role" }, origin);
    }

    // If INSTRUCTOR, check assignment to this class
    if (membership.role === "INSTRUCTOR") {
      const { data: assignment } = await supabase
        .from("instructor_assignments")
        .select("id")
        .eq("org_id", cls.org_id)
        .eq("user_id", userId)
        .eq("class_id", classId)
        .eq("status", "active")
        .maybeSingle();
      if (!assignment) return json(403, { error: "Not assigned to this class" }, origin);
    }

    // Parallel: curriculum title, members, instructor assignments, readiness
    const [curriculumRes, membersRes, assignmentsRes] = await Promise.all([
      cls.curriculum_id
        ? supabase.from("curricula").select("id, title").eq("id", cls.curriculum_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("class_memberships")
        .select("id, user_id, role, status, enrolled_at")
        .eq("class_id", classId)
        .eq("status", "active"),
      supabase
        .from("instructor_assignments")
        .select("id, user_id, role, status, assigned_at")
        .eq("class_id", classId)
        .eq("status", "active"),
    ]);

    const members = membersRes.data ?? [];
    const students = members.filter((m: any) => m.role === "student");
    const studentIds = students.map((s: any) => s.user_id);
    const instructorAssignments = assignmentsRes.data ?? [];
    const instructorIds = instructorAssignments.map((i: any) => i.user_id);

    // Parallel: profiles for students + instructors, readiness for students, last exam sessions
    const allUserIds = [...new Set([...studentIds, ...instructorIds])];
    const [profilesRes, readinessRes, examSessionsRes] = await Promise.all([
      allUserIds.length > 0
        ? supabase.from("profiles").select("id, full_name, email").in("id", allUserIds)
        : Promise.resolve({ data: [] }),
      studentIds.length > 0 && cls.curriculum_id
        ? supabase
            .from("readiness_snapshots")
            .select("user_id, readiness_score, risk_level, mastery_pct, created_at")
            .in("user_id", studentIds)
            .eq("curriculum_id", cls.curriculum_id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      studentIds.length > 0 && cls.curriculum_id
        ? supabase
            .from("exam_sessions")
            .select("user_id, score_percentage, finished_at")
            .in("user_id", studentIds)
            .eq("curriculum_id", cls.curriculum_id)
            .not("finished_at", "is", null)
            .order("finished_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const profileMap = Object.fromEntries((profilesRes.data ?? []).map((p: any) => [p.id, p]));

    // Latest readiness per student (deduplicate to most recent)
    const readinessMap: Record<string, any> = {};
    for (const r of (readinessRes.data ?? [])) {
      if (!readinessMap[r.user_id]) readinessMap[r.user_id] = r;
    }

    // Latest exam score per student
    const examMap: Record<string, any> = {};
    for (const e of (examSessionsRes.data ?? [])) {
      if (!examMap[e.user_id]) examMap[e.user_id] = e;
    }

    const now = Date.now();

    // Build student list with readiness
    const studentProfiles = students.map((s: any) => {
      const profile = profileMap[s.user_id];
      const readiness = readinessMap[s.user_id];
      const exam = examMap[s.user_id];
      const lastActivity = readiness?.created_at || exam?.finished_at || s.enrolled_at;
      const inactiveDays = lastActivity ? Math.floor((now - new Date(lastActivity).getTime()) / 86400000) : null;

      return {
        user_id: s.user_id,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        enrolled_at: s.enrolled_at,
        readiness_score: readiness?.readiness_score ?? 0,
        risk_level: readiness?.risk_level ?? "not_started",
        progress_pct: readiness?.mastery_pct ?? 0,
        last_exam_score: exam?.score_percentage ?? null,
        last_activity_at: lastActivity ?? null,
        inactive_days: inactiveDays,
      };
    });

    // Build instructor list
    const instructorProfiles = instructorAssignments.map((a: any) => {
      const profile = profileMap[a.user_id];
      return {
        assignment_id: a.id,
        user_id: a.user_id,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        role: a.role ?? "primary",
        assigned_at: a.assigned_at,
      };
    });

    // KPIs
    const readinessScores = studentProfiles.map((s: any) => s.readiness_score);
    const progressScores = studentProfiles.map((s: any) => s.progress_pct);
    const avgReadiness = readinessScores.length > 0
      ? Math.round((readinessScores.reduce((a: number, b: number) => a + b, 0) / readinessScores.length) * 10) / 10
      : 0;
    const avgProgress = progressScores.length > 0
      ? Math.round((progressScores.reduce((a: number, b: number) => a + b, 0) / progressScores.length) * 10) / 10
      : 0;

    const riskCounts = { high: 0, medium: 0, low: 0, not_started: 0 };
    for (const s of studentProfiles) {
      const rl = s.risk_level as keyof typeof riskCounts;
      if (rl in riskCounts) riskCounts[rl]++;
      else riskCounts.not_started++;
    }

    const inactiveCount = studentProfiles.filter((s: any) => s.inactive_days !== null && s.inactive_days > 14).length;
    const active7 = studentProfiles.filter((s: any) => s.inactive_days !== null && s.inactive_days <= 7).length;
    const active14 = studentProfiles.filter((s: any) => s.inactive_days !== null && s.inactive_days <= 14).length;

    return json(200, {
      class: {
        ...cls,
        curriculum_title: curriculumRes.data?.title ?? null,
      },
      kpis: {
        student_count: studentProfiles.length,
        instructor_count: instructorProfiles.length,
        avg_readiness_score: avgReadiness,
        avg_progress_pct: avgProgress,
        high_risk_count: riskCounts.high,
        medium_risk_count: riskCounts.medium,
        low_risk_count: riskCounts.low,
        not_started_count: riskCounts.not_started,
        inactive_count: inactiveCount,
      },
      students: studentProfiles,
      instructors: instructorProfiles,
      readiness_distribution: riskCounts,
      activity_summary: {
        active_last_7_days: active7,
        active_last_14_days: active14,
        inactive_over_14_days: inactiveCount,
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
