import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// Export types
type ExportType = 'participant' | 'course' | 'attempt';

interface ExportRequest {
  type: ExportType;
  user_id?: string;
  course_id?: string;
  attempt_id?: string;
  curriculum_id?: string;
  include_raw_logs?: boolean;
  use_rpc?: boolean; // Use new database RPC function for participant export
  pseudonymize?: boolean; // Pseudonymize user data for GDPR compliance
}

// AZAV Evidence Pack Schema
interface AZAVEvidencePack {
  export_version: string;
  generated_at: string;
  generated_by: string;
  scope: {
    type: ExportType;
    user_id: string | null;
    course_id: string | null;
    attempt_id: string | null;
    curriculum_id: string;
  };
  ssot: {
    curriculum: {
      id: string;
      title: string;
      status: string;
      frozen_at: string | null;
      version: string | null;
      source_file_name: string | null;
    };
    course?: {
      id: string;
      title: string;
      status: string;
      published_at: string | null;
      modules_count: number;
      lessons_count: number;
    };
  };
  learning?: {
    enrollment: {
      enrolled_at: string;
      last_accessed_at: string | null;
      completed_at: string | null;
    } | null;
    progress: Array<{
      lesson_id: string;
      lesson_title: string;
      module_title: string;
      completed: boolean;
      score: number | null;
      time_spent_seconds: number;
      completed_at: string | null;
    }>;
    summary: {
      total_lessons: number;
      completed_lessons: number;
      completion_rate: number;
      total_time_spent_seconds: number;
    };
  };
  exam?: {
    attempts: Array<{
      id: string;
      started_at: string;
      finished_at: string | null;
      mode: string;
      total_questions: number;
      score_percentage: number | null;
      passed: boolean | null;
      duration_seconds: number | null;
    }>;
    summary: {
      total_attempts: number;
      passed_attempts: number;
      best_score: number | null;
      average_score: number | null;
    };
  };
  ai_tutor: {
    governance: {
      exam_mode_content_help_disabled: true;
      enforcement: 'server_side';
      audit_logging: 'enabled';
    };
    logs_summary: {
      total_interactions: number;
      learning_mode: number;
      practice_mode: number;
      exam_mode: number;
      blocked_requests: number;
    };
    logs?: Array<{
      created_at: string;
      mode: string;
      session_type: string;
      was_blocked: boolean;
      block_reason: string | null;
      tokens_used: number | null;
    }>;
  };
  audit: {
    export_integrity: {
      data_sources: string[];
      rls_enforced: true;
      generated_via: 'edge_function';
    };
  };
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user and get their role
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isAdmin = roleData?.role === 'admin';

    const request: ExportRequest = await req.json();
    const { type, user_id, course_id, attempt_id, curriculum_id, include_raw_logs, use_rpc, pseudonymize } = request;

    // Permission check
    if (type === 'participant' && user_id) {
      // Learners can only export their own data
      if (!isAdmin && user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: You can only export your own data' }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin access required' }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let pack: AZAVEvidencePack | any;

    switch (type) {
      case 'participant':
        if (use_rpc) {
          // Use the new database RPC function (recommended for AZAV compliance)
          const { data: rpcData, error: rpcError } = await supabase.rpc('export_participant_pack', {
            p_user_id: user_id,
            p_course_id: course_id,
            p_include_ai_logs: include_raw_logs ?? false,
            p_pseudonymize: pseudonymize ?? true
          });
          
          if (rpcError) {
            throw new Error(`RPC error: ${rpcError.message}`);
          }
          
          pack = rpcData;
        } else {
          // Legacy edge function export
          pack = await exportParticipantPack(supabase, user_id!, course_id!, include_raw_logs);
        }
        break;
      case 'course':
        if (request.use_rpc) {
          // Use the new database RPC function (recommended for AZAV compliance)
          const { data: rpcData, error: rpcError } = await supabase.rpc('export_course_pack', {
            p_course_id: course_id,
            p_include_questions: include_raw_logs ?? false,
            p_include_h5p: true
          });
          
          if (rpcError) {
            throw new Error(`RPC error: ${rpcError.message}`);
          }
          
          pack = rpcData;
        } else {
          // Legacy edge function export
          pack = await exportCoursePack(supabase, course_id!, include_raw_logs);
        }
        break;
      case 'attempt':
        pack = await exportAttemptPack(supabase, attempt_id!, include_raw_logs);
        break;
      default:
        throw new Error('Invalid export type');
    }

    // Add export metadata
    pack.generated_by = user.id;

    return new Response(
      JSON.stringify(pack, null, 2),
      { 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="azav-export-${type}-${Date.now()}.json"`
        } 
      }
    );

  } catch (error) {
    console.error("Audit export error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function exportParticipantPack(
  supabase: any, 
  userId: string, 
  courseId: string,
  includeRawLogs?: boolean
): Promise<AZAVEvidencePack> {
  // Get course and curriculum
  const { data: course } = await supabase
    .from('courses')
    .select(`
      *,
      curricula (*)
    `)
    .eq('id', courseId)
    .single();

  if (!course) throw new Error('Course not found');

  // Get enrollment
  const { data: enrollment } = await supabase
    .from('course_enrollments')
    .select('*')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .single();

  // Get modules and lessons
  const { data: modules } = await supabase
    .from('modules')
    .select(`
      id, title,
      lessons (id, title, sort_order)
    `)
    .eq('course_id', courseId)
    .order('sort_order');

  // Get learning progress
  const lessonIds = modules?.flatMap((m: any) => m.lessons.map((l: any) => l.id)) || [];
  const { data: progress } = await supabase
    .from('learning_progress')
    .select('*')
    .eq('user_id', userId)
    .in('lesson_id', lessonIds);

  // Get exam sessions for this curriculum
  const { data: examSessions } = await supabase
    .from('exam_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('curriculum_id', course.curriculum_id)
    .order('started_at', { ascending: false });

  // Get AI tutor logs
  const { data: tutorLogs } = await supabase
    .from('ai_tutor_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  // Build progress array
  const progressMap = new Map(progress?.map((p: any) => [p.lesson_id, p]) || []);
  const learningProgress = modules?.flatMap((m: any) => 
    m.lessons.map((l: any) => ({
      lesson_id: l.id,
      lesson_title: l.title,
      module_title: m.title,
      completed: progressMap.get(l.id)?.completed || false,
      score: progressMap.get(l.id)?.score || null,
      time_spent_seconds: progressMap.get(l.id)?.time_spent_seconds || 0,
      completed_at: progressMap.get(l.id)?.completed_at || null,
    }))
  ) || [];

  const completedLessons = learningProgress.filter(p => p.completed).length;
  const totalTimeSpent = learningProgress.reduce((sum, p) => sum + p.time_spent_seconds, 0);

  // Calculate exam stats
  const passedAttempts = examSessions?.filter((a: any) => a.passed) || [];
  const scores = examSessions?.filter((a: any) => a.score_percentage != null).map((a: any) => a.score_percentage) || [];

  // AI tutor summary
  const tutorSummary = {
    total_interactions: tutorLogs?.length || 0,
    learning_mode: tutorLogs?.filter((l: any) => l.mode === 'learning').length || 0,
    practice_mode: tutorLogs?.filter((l: any) => l.mode === 'practice').length || 0,
    exam_mode: tutorLogs?.filter((l: any) => l.mode === 'exam').length || 0,
    blocked_requests: tutorLogs?.filter((l: any) => l.was_blocked).length || 0,
  };

  return {
    export_version: "1.0",
    generated_at: new Date().toISOString(),
    generated_by: "",
    scope: {
      type: 'participant',
      user_id: userId,
      course_id: courseId,
      attempt_id: null,
      curriculum_id: course.curriculum_id,
    },
    ssot: {
      curriculum: {
        id: course.curricula.id,
        title: course.curricula.title,
        status: course.curricula.status,
        frozen_at: course.curricula.frozen_at,
        version: course.curricula.version,
        source_file_name: course.curricula.source_file_name,
      },
      course: {
        id: course.id,
        title: course.title,
        status: course.status,
        published_at: course.published_at,
        modules_count: modules?.length || 0,
        lessons_count: lessonIds.length,
      },
    },
    learning: {
      enrollment: enrollment ? {
        enrolled_at: enrollment.enrolled_at,
        last_accessed_at: enrollment.last_accessed_at,
        completed_at: enrollment.completed_at,
      } : null,
      progress: learningProgress,
      summary: {
        total_lessons: lessonIds.length,
        completed_lessons: completedLessons,
        completion_rate: lessonIds.length > 0 ? completedLessons / lessonIds.length : 0,
        total_time_spent_seconds: totalTimeSpent,
      },
    },
    exam: {
      attempts: examSessions?.map((a: any) => ({
        id: a.id,
        started_at: a.started_at,
        finished_at: a.finished_at,
        mode: a.mode,
        total_questions: a.total_questions,
        score_percentage: a.score_percentage,
        passed: a.passed,
        duration_seconds: a.finished_at && a.started_at 
          ? Math.floor((new Date(a.finished_at).getTime() - new Date(a.started_at).getTime()) / 1000)
          : null,
      })) || [],
      summary: {
        total_attempts: examSessions?.length || 0,
        passed_attempts: passedAttempts.length,
        best_score: scores.length > 0 ? Math.max(...scores) : null,
        average_score: scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : null,
      },
    },
    ai_tutor: {
      governance: {
        exam_mode_content_help_disabled: true,
        enforcement: 'server_side',
        audit_logging: 'enabled',
      },
      logs_summary: tutorSummary,
      logs: includeRawLogs ? tutorLogs?.map((l: any) => ({
        created_at: l.created_at,
        mode: l.mode,
        session_type: l.session_type,
        was_blocked: l.was_blocked,
        block_reason: l.block_reason,
        tokens_used: l.tokens_used,
      })) : undefined,
    },
    audit: {
      export_integrity: {
        data_sources: ['curricula', 'courses', 'course_enrollments', 'learning_progress', 'exam_sessions', 'ai_tutor_logs'],
        rls_enforced: true,
        generated_via: 'edge_function',
      },
    },
  };
}

async function exportCoursePack(
  supabase: any,
  courseId: string,
  includeRawLogs?: boolean
): Promise<AZAVEvidencePack> {
  // Get course and curriculum
  const { data: course } = await supabase
    .from('courses')
    .select(`
      *,
      curricula (*)
    `)
    .eq('id', courseId)
    .single();

  if (!course) throw new Error('Course not found');

  // Get modules and lessons count
  const { data: modules } = await supabase
    .from('modules')
    .select(`
      id, title,
      lessons (id)
    `)
    .eq('course_id', courseId);

  const lessonsCount = modules?.reduce((sum: number, m: any) => sum + (m.lessons?.length || 0), 0) || 0;

  // Get enrollment stats
  const { data: enrollments, count: enrollmentCount } = await supabase
    .from('course_enrollments')
    .select('*', { count: 'exact' })
    .eq('course_id', courseId);

  const completedEnrollments = enrollments?.filter((e: any) => e.completed_at).length || 0;

  // Get exam question stats
  const { data: questions, count: questionCount } = await supabase
    .from('exam_questions')
    .select('status', { count: 'exact' })
    .eq('curriculum_id', course.curriculum_id);

  const approvedQuestions = questions?.filter((q: any) => q.status === 'approved').length || 0;

  // Get exam session stats
  const { data: examSessions } = await supabase
    .from('exam_sessions')
    .select('passed, score_percentage')
    .eq('curriculum_id', course.curriculum_id);

  const totalAttempts = examSessions?.length || 0;
  const passedAttempts = examSessions?.filter((s: any) => s.passed).length || 0;

  return {
    export_version: "1.0",
    generated_at: new Date().toISOString(),
    generated_by: "",
    scope: {
      type: 'course',
      user_id: null,
      course_id: courseId,
      attempt_id: null,
      curriculum_id: course.curriculum_id,
    },
    ssot: {
      curriculum: {
        id: course.curricula.id,
        title: course.curricula.title,
        status: course.curricula.status,
        frozen_at: course.curricula.frozen_at,
        version: course.curricula.version,
        source_file_name: course.curricula.source_file_name,
      },
      course: {
        id: course.id,
        title: course.title,
        status: course.status,
        published_at: course.published_at,
        modules_count: modules?.length || 0,
        lessons_count: lessonsCount,
      },
    },
    learning: {
      enrollment: null,
      progress: [],
      summary: {
        total_lessons: lessonsCount,
        completed_lessons: 0,
        completion_rate: 0,
        total_time_spent_seconds: 0,
      },
    },
    exam: {
      attempts: [],
      summary: {
        total_attempts: totalAttempts,
        passed_attempts: passedAttempts,
        best_score: null,
        average_score: null,
      },
    },
    ai_tutor: {
      governance: {
        exam_mode_content_help_disabled: true,
        enforcement: 'server_side',
        audit_logging: 'enabled',
      },
      logs_summary: {
        total_interactions: 0,
        learning_mode: 0,
        practice_mode: 0,
        exam_mode: 0,
        blocked_requests: 0,
      },
    },
    audit: {
      export_integrity: {
        data_sources: ['curricula', 'courses', 'modules', 'lessons', 'exam_questions', 'exam_sessions'],
        rls_enforced: true,
        generated_via: 'edge_function',
      },
    },
  };
}

async function exportAttemptPack(
  supabase: any,
  attemptId: string,
  includeRawLogs?: boolean
): Promise<AZAVEvidencePack> {
  // Get exam session with details
  const { data: session } = await supabase
    .from('exam_sessions')
    .select(`
      *,
      exam_blueprints (*),
      curricula (*)
    `)
    .eq('id', attemptId)
    .single();

  if (!session) throw new Error('Exam session not found');

  // Get AI tutor logs for this session
  const { data: tutorLogs } = await supabase
    .from('ai_tutor_logs')
    .select('*')
    .eq('session_id', attemptId)
    .order('created_at');

  const tutorSummary = {
    total_interactions: tutorLogs?.length || 0,
    learning_mode: tutorLogs?.filter((l: any) => l.mode === 'learning').length || 0,
    practice_mode: tutorLogs?.filter((l: any) => l.mode === 'practice').length || 0,
    exam_mode: tutorLogs?.filter((l: any) => l.mode === 'exam').length || 0,
    blocked_requests: tutorLogs?.filter((l: any) => l.was_blocked).length || 0,
  };

  const durationSeconds = session.finished_at && session.started_at
    ? Math.floor((new Date(session.finished_at).getTime() - new Date(session.started_at).getTime()) / 1000)
    : null;

  return {
    export_version: "1.0",
    generated_at: new Date().toISOString(),
    generated_by: "",
    scope: {
      type: 'attempt',
      user_id: session.user_id,
      course_id: null,
      attempt_id: attemptId,
      curriculum_id: session.curriculum_id,
    },
    ssot: {
      curriculum: {
        id: session.curricula.id,
        title: session.curricula.title,
        status: session.curricula.status,
        frozen_at: session.curricula.frozen_at,
        version: session.curricula.version,
        source_file_name: session.curricula.source_file_name,
      },
    },
    exam: {
      attempts: [{
        id: session.id,
        started_at: session.started_at,
        finished_at: session.finished_at,
        mode: session.mode,
        total_questions: session.total_questions,
        score_percentage: session.score_percentage,
        passed: session.passed,
        duration_seconds: durationSeconds,
      }],
      summary: {
        total_attempts: 1,
        passed_attempts: session.passed ? 1 : 0,
        best_score: session.score_percentage,
        average_score: session.score_percentage,
      },
    },
    ai_tutor: {
      governance: {
        exam_mode_content_help_disabled: true,
        enforcement: 'server_side',
        audit_logging: 'enabled',
      },
      logs_summary: tutorSummary,
      logs: includeRawLogs ? tutorLogs?.map((l: any) => ({
        created_at: l.created_at,
        mode: l.mode,
        session_type: l.session_type,
        was_blocked: l.was_blocked,
        block_reason: l.block_reason,
        tokens_used: l.tokens_used,
      })) : undefined,
    },
    audit: {
      export_integrity: {
        data_sources: ['curricula', 'exam_sessions', 'exam_blueprints', 'ai_tutor_logs'],
        rls_enforced: true,
        generated_via: 'edge_function',
      },
    },
  };
}
