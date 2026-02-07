export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_tutor_logs: {
        Row: {
          block_reason: string | null
          created_at: string
          id: string
          metadata: Json | null
          mode: string
          prompt_hash: string
          prompt_length: number
          response_hash: string
          response_length: number
          session_id: string | null
          session_type: string
          tokens_used: number | null
          user_id: string
          was_blocked: boolean
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          mode: string
          prompt_hash: string
          prompt_length: number
          response_hash: string
          response_length: number
          session_id?: string | null
          session_type: string
          tokens_used?: number | null
          user_id: string
          was_blocked?: boolean
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          mode?: string
          prompt_hash?: string
          prompt_length?: number
          response_hash?: string
          response_length?: number
          session_id?: string | null
          session_type?: string
          tokens_used?: number | null
          user_id?: string
          was_blocked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_tutor_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_worker_policies: {
        Row: {
          created_at: string
          enabled: boolean
          job_type: string
          max_attempts: number
          max_cost_eur_per_day: number
          max_parallel: number
          max_tokens_per_run: number
          pause_on_error_rate: number
          timeout_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          job_type: string
          max_attempts?: number
          max_cost_eur_per_day?: number
          max_parallel?: number
          max_tokens_per_run?: number
          pause_on_error_rate?: number
          timeout_seconds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          job_type?: string
          max_attempts?: number
          max_cost_eur_per_day?: number
          max_parallel?: number
          max_tokens_per_run?: number
          pause_on_error_rate?: number
          timeout_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_worker_usage_daily: {
        Row: {
          cost_eur: number
          created_at: string
          date: string
          errors: number
          id: string
          job_type: string
          runs: number
          tokens_used: number
          updated_at: string
        }
        Insert: {
          cost_eur?: number
          created_at?: string
          date?: string
          errors?: number
          id?: string
          job_type: string
          runs?: number
          tokens_used?: number
          updated_at?: string
        }
        Update: {
          cost_eur?: number
          created_at?: string
          date?: string
          errors?: number
          id?: string
          job_type?: string
          runs?: number
          tokens_used?: number
          updated_at?: string
        }
        Relationships: []
      }
      competencies: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          learning_field_id: string
          sort_order: number | null
          taxonomy_level: string | null
          title: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          learning_field_id: string
          sort_order?: number | null
          taxonomy_level?: string | null
          title: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          learning_field_id?: string
          sort_order?: number | null
          taxonomy_level?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "competencies_learning_field_id_fkey"
            columns: ["learning_field_id"]
            isOneToOne: false
            referencedRelation: "learning_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      course_enrollments: {
        Row: {
          completed_at: string | null
          course_id: string
          enrolled_at: string
          id: string
          last_accessed_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          enrolled_at?: string
          id?: string
          last_accessed_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          enrolled_at?: string
          id?: string
          last_accessed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          created_by: string | null
          curriculum_id: string
          description: string | null
          estimated_duration: number | null
          id: string
          published_at: string | null
          status: Database["public"]["Enums"]["course_status"]
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          curriculum_id: string
          description?: string | null
          estimated_duration?: number | null
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["course_status"]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          curriculum_id?: string
          description?: string | null
          estimated_duration?: number | null
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["course_status"]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      curricula: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          extracted_data: Json | null
          frozen_at: string | null
          id: string
          normalized_data: Json | null
          source_file_name: string | null
          source_file_url: string | null
          status: Database["public"]["Enums"]["curriculum_status"]
          title: string
          updated_at: string
          version: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          extracted_data?: Json | null
          frozen_at?: string | null
          id?: string
          normalized_data?: Json | null
          source_file_name?: string | null
          source_file_url?: string | null
          status?: Database["public"]["Enums"]["curriculum_status"]
          title: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          extracted_data?: Json | null
          frozen_at?: string | null
          id?: string
          normalized_data?: Json | null
          source_file_name?: string | null
          source_file_url?: string | null
          status?: Database["public"]["Enums"]["curriculum_status"]
          title?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      exam_attempts: {
        Row: {
          answers: Json | null
          completed_at: string | null
          curriculum_id: string
          id: string
          score: number | null
          started_at: string
          time_limit_minutes: number | null
          total_questions: number | null
          user_id: string
        }
        Insert: {
          answers?: Json | null
          completed_at?: string | null
          curriculum_id: string
          id?: string
          score?: number | null
          started_at?: string
          time_limit_minutes?: number | null
          total_questions?: number | null
          user_id: string
        }
        Update: {
          answers?: Json | null
          completed_at?: string | null
          curriculum_id?: string
          id?: string
          score?: number | null
          started_at?: string
          time_limit_minutes?: number | null
          total_questions?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_blueprints: {
        Row: {
          created_at: string
          created_by: string | null
          curriculum_id: string
          description: string | null
          difficulty_distribution: Json
          frozen: boolean
          frozen_at: string | null
          id: string
          pass_threshold: number
          question_types: Json
          section_weights: Json
          time_limit_minutes: number
          title: string
          total_questions: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          curriculum_id: string
          description?: string | null
          difficulty_distribution?: Json
          frozen?: boolean
          frozen_at?: string | null
          id?: string
          pass_threshold?: number
          question_types?: Json
          section_weights?: Json
          time_limit_minutes?: number
          title: string
          total_questions?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          curriculum_id?: string
          description?: string | null
          difficulty_distribution?: Json
          frozen?: boolean
          frozen_at?: string | null
          id?: string
          pass_threshold?: number
          question_types?: Json
          section_weights?: Json
          time_limit_minutes?: number
          title?: string
          total_questions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_blueprints_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          ai_generated: boolean | null
          competency_id: string | null
          correct_answer: number
          created_at: string
          curriculum_id: string
          difficulty: Database["public"]["Enums"]["question_difficulty"] | null
          explanation: string | null
          id: string
          learning_field_id: string | null
          options: Json
          question_text: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["question_status"] | null
        }
        Insert: {
          ai_generated?: boolean | null
          competency_id?: string | null
          correct_answer: number
          created_at?: string
          curriculum_id: string
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null
          explanation?: string | null
          id?: string
          learning_field_id?: string | null
          options: Json
          question_text: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["question_status"] | null
        }
        Update: {
          ai_generated?: boolean | null
          competency_id?: string | null
          correct_answer?: number
          created_at?: string
          curriculum_id?: string
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null
          explanation?: string | null
          id?: string
          learning_field_id?: string | null
          options?: Json
          question_text?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["question_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_learning_field_id_fkey"
            columns: ["learning_field_id"]
            isOneToOne: false
            referencedRelation: "learning_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_session_questions: {
        Row: {
          answered_at: string | null
          competency_code: string | null
          created_at: string
          difficulty: string
          exam_session_id: string
          id: string
          is_correct: boolean | null
          learning_field_code: string | null
          order_index: number
          question_id: string
          time_spent_seconds: number | null
          user_answer: number | null
        }
        Insert: {
          answered_at?: string | null
          competency_code?: string | null
          created_at?: string
          difficulty: string
          exam_session_id: string
          id?: string
          is_correct?: boolean | null
          learning_field_code?: string | null
          order_index: number
          question_id: string
          time_spent_seconds?: number | null
          user_answer?: number | null
        }
        Update: {
          answered_at?: string | null
          competency_code?: string | null
          created_at?: string
          difficulty?: string
          exam_session_id?: string
          id?: string
          is_correct?: boolean | null
          learning_field_code?: string | null
          order_index?: number
          question_id?: string
          time_spent_seconds?: number | null
          user_answer?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_session_questions_exam_session_id_fkey"
            columns: ["exam_session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_session_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_sessions: {
        Row: {
          blueprint_id: string
          breakdown: Json | null
          created_at: string
          current_index: number
          curriculum_id: string
          finished_at: string | null
          id: string
          mode: string
          passed: boolean | null
          points_earned: number | null
          points_total: number | null
          score_percentage: number | null
          seed: number
          started_at: string
          time_limit_minutes: number | null
          total_questions: number
          user_id: string
        }
        Insert: {
          blueprint_id: string
          breakdown?: Json | null
          created_at?: string
          current_index?: number
          curriculum_id: string
          finished_at?: string | null
          id?: string
          mode?: string
          passed?: boolean | null
          points_earned?: number | null
          points_total?: number | null
          score_percentage?: number | null
          seed: number
          started_at?: string
          time_limit_minutes?: number | null
          total_questions: number
          user_id: string
        }
        Update: {
          blueprint_id?: string
          breakdown?: Json | null
          created_at?: string
          current_index?: number
          curriculum_id?: string
          finished_at?: string | null
          id?: string
          mode?: string
          passed?: boolean | null
          points_earned?: number | null
          points_total?: number | null
          score_percentage?: number | null
          seed?: number
          started_at?: string
          time_limit_minutes?: number | null
          total_questions?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_sessions_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "exam_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_sessions_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          run_after: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload: Json
          priority?: number
          result?: Json | null
          run_after?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          run_after?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      learning_fields: {
        Row: {
          code: string
          created_at: string
          curriculum_id: string
          description: string | null
          hours: number | null
          id: string
          sort_order: number | null
          title: string
        }
        Insert: {
          code: string
          created_at?: string
          curriculum_id: string
          description?: string | null
          hours?: number | null
          id?: string
          sort_order?: number | null
          title: string
        }
        Update: {
          code?: string
          created_at?: string
          curriculum_id?: string
          description?: string | null
          hours?: number | null
          id?: string
          sort_order?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_fields_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_progress: {
        Row: {
          completed: boolean | null
          completed_at: string | null
          created_at: string
          id: string
          lesson_id: string
          score: number | null
          time_spent_seconds: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_id: string
          score?: number | null
          time_spent_seconds?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_id?: string
          score?: number | null
          time_spent_seconds?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          competency_id: string | null
          content: Json | null
          created_at: string
          duration_minutes: number | null
          h5p_content_id: string | null
          id: string
          module_id: string
          sort_order: number | null
          step: Database["public"]["Enums"]["lesson_step"]
          title: string
        }
        Insert: {
          competency_id?: string | null
          content?: Json | null
          created_at?: string
          duration_minutes?: number | null
          h5p_content_id?: string | null
          id?: string
          module_id: string
          sort_order?: number | null
          step: Database["public"]["Enums"]["lesson_step"]
          title: string
        }
        Update: {
          competency_id?: string | null
          content?: Json | null
          created_at?: string
          duration_minutes?: number | null
          h5p_content_id?: string | null
          id?: string
          module_id?: string
          sort_order?: number | null
          step?: Database["public"]["Enums"]["lesson_step"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          id: string
          learning_field_id: string | null
          sort_order: number | null
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          learning_field_id?: string | null
          sort_order?: number | null
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          learning_field_id?: string | null
          sort_order?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modules_learning_field_id_fkey"
            columns: ["learning_field_id"]
            isOneToOne: false
            referencedRelation: "learning_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_competency_stats: {
        Row: {
          competency_id: string | null
          correct_attempts: number
          curriculum_id: string
          id: string
          last_difficulty: string | null
          learning_field_id: string | null
          mastery_level: number | null
          streak: number
          total_attempts: number
          updated_at: string
          user_id: string
        }
        Insert: {
          competency_id?: string | null
          correct_attempts?: number
          curriculum_id: string
          id?: string
          last_difficulty?: string | null
          learning_field_id?: string | null
          mastery_level?: number | null
          streak?: number
          total_attempts?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          competency_id?: string | null
          correct_attempts?: number
          curriculum_id?: string
          id?: string
          last_difficulty?: string | null
          learning_field_id?: string | null
          mastery_level?: number | null
          streak?: number
          total_attempts?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_competency_stats_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_competency_stats_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_competency_stats_learning_field_id_fkey"
            columns: ["learning_field_id"]
            isOneToOne: false
            referencedRelation: "learning_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      ai_worker_health: {
        Row: {
          cost_today: number | null
          enabled: boolean | null
          error_rate: number | null
          errors_today: number | null
          job_type: string | null
          max_attempts: number | null
          max_cost_eur_per_day: number | null
          max_parallel: number | null
          max_tokens_per_run: number | null
          pause_on_error_rate: number | null
          policy_updated_at: string | null
          runs_today: number | null
          status: string | null
          timeout_seconds: number | null
          tokens_today: number | null
        }
        Relationships: []
      }
      job_deadletter: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          id: string | null
          job_type: string | null
          last_error: string | null
          max_attempts: number | null
          payload: Json | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          id?: string | null
          job_type?: string | null
          last_error?: string | null
          max_attempts?: number | null
          payload?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          id?: string | null
          job_type?: string | null
          last_error?: string | null
          max_attempts?: number | null
          payload?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      job_failure_analysis: {
        Row: {
          count: number | null
          error_class: string | null
          error_samples: string[] | null
          job_type: string | null
        }
        Relationships: []
      }
      job_health_kpis: {
        Row: {
          cancelled: number | null
          completed: number | null
          failed: number | null
          job_type: string | null
          last_update: string | null
          pending: number | null
          processing: number | null
          total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      assert_job_payload: { Args: { job: Json }; Returns: undefined }
      can_worker_claim: { Args: { p_job_type: string }; Returns: boolean }
      claim_next_job: {
        Args: {
          p_job_types?: string[]
          p_lock_timeout_minutes?: number
          p_worker_id: string
        }
        Returns: Json
      }
      classify_job_error: { Args: { p_error: string }; Returns: string }
      cleanup_stale_locks: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
      complete_job:
        | {
            Args: {
              p_cost_eur?: number
              p_job_id: string
              p_result?: Json
              p_tokens_used?: number
            }
            Returns: undefined
          }
        | { Args: { p_job_id: string; p_result?: Json }; Returns: undefined }
      create_job: {
        Args: {
          p_job_type: string
          p_payload: Json
          p_priority?: number
          p_run_after?: string
        }
        Returns: string
      }
      fail_job: {
        Args: { p_allow_retry?: boolean; p_error: string; p_job_id: string }
        Returns: undefined
      }
      finish_exam_session: { Args: { p_session_id: string }; Returns: Json }
      generate_exam_questions: {
        Args: { p_blueprint_id: string; p_seed: number }
        Returns: {
          competency_code: string
          difficulty: string
          learning_field_code: string
          order_index: number
          question_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      job_maintenance: { Args: never; Returns: Json }
      record_worker_usage: {
        Args: {
          p_cost_eur?: number
          p_is_error?: boolean
          p_job_type: string
          p_tokens_used?: number
        }
        Returns: undefined
      }
      requeue_failed_jobs: { Args: never; Returns: number }
      start_exam_session: {
        Args: { p_blueprint_id: string; p_mode?: string }
        Returns: string
      }
      submit_exam_answer: {
        Args: {
          p_answer: number
          p_question_index: number
          p_session_id: string
          p_time_spent?: number
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "learner"
      course_status: "draft" | "generating" | "published" | "archived"
      curriculum_status: "draft" | "extracting" | "normalizing" | "frozen"
      exam_mode: "simulation" | "practice" | "timed_exam"
      lesson_step:
        | "einstieg"
        | "verstehen"
        | "anwenden"
        | "wiederholen"
        | "mini_check"
      question_difficulty: "easy" | "medium" | "hard"
      question_status: "draft" | "review" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "teacher", "learner"],
      course_status: ["draft", "generating", "published", "archived"],
      curriculum_status: ["draft", "extracting", "normalizing", "frozen"],
      exam_mode: ["simulation", "practice", "timed_exam"],
      lesson_step: [
        "einstieg",
        "verstehen",
        "anwenden",
        "wiederholen",
        "mini_check",
      ],
      question_difficulty: ["easy", "medium", "hard"],
      question_status: ["draft", "review", "approved", "rejected"],
    },
  },
} as const
