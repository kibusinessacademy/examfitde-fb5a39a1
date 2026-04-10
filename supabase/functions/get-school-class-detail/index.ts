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

    // Get class with org
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

    // Parallel: members + instructor assignments for this class
    const [membersRes, assignmentsRes] = await Promise.all([
      supabase
        .from("class_memberships")
        .select("id, user_id, role, status, joined_at")
        .eq("class_id", classId)
        .eq("status", "active"),
      supabase
        .from("instructor_assignments")
        .select("id, user_id, assignment_type, can_view_progress, can_grade")
        .eq("class_id", classId)
        .eq("status", "active"),
    ]);

    const members = membersRes.data ?? [];
    const students = members.filter((m: any) => m.role === "student");

    // Resolve student profile names
    let studentProfiles: any[] = [];
    if (students.length > 0) {
      const studentIds = students.map((s: any) => s.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", studentIds);
      const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
      studentProfiles = students.map((s: any) => ({
        membership_id: s.id,
        user_id: s.user_id,
        joined_at: s.joined_at,
        first_name: profileMap[s.user_id]?.first_name ?? null,
        last_name: profileMap[s.user_id]?.last_name ?? null,
        email: profileMap[s.user_id]?.email ?? null,
      }));
    }

    return json(200, {
      class: cls,
      students: studentProfiles,
      instructors: assignmentsRes.data ?? [],
      kpis: {
        total_students: students.length,
        total_instructors: (assignmentsRes.data ?? []).length,
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
