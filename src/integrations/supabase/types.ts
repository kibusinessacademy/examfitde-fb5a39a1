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
      affiliate_payouts: {
        Row: {
          affiliate_id: string
          amount: number
          created_at: string | null
          id: string
          payment_method: string | null
          processed_at: string | null
          processed_by: string | null
          status: string | null
          transaction_reference: string | null
        }
        Insert: {
          affiliate_id: string
          amount: number
          created_at?: string | null
          id?: string
          payment_method?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          transaction_reference?: string | null
        }
        Update: {
          affiliate_id?: string
          amount?: number
          created_at?: string | null
          id?: string
          payment_method?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_referrals: {
        Row: {
          affiliate_id: string
          commission_amount: number | null
          confirmed_at: string | null
          course_id: string | null
          id: string
          paid_at: string | null
          purchase_amount: number | null
          referred_at: string | null
          referred_user_id: string
          status: string | null
        }
        Insert: {
          affiliate_id: string
          commission_amount?: number | null
          confirmed_at?: string | null
          course_id?: string | null
          id?: string
          paid_at?: string | null
          purchase_amount?: number | null
          referred_at?: string | null
          referred_user_id: string
          status?: string | null
        }
        Update: {
          affiliate_id?: string
          commission_amount?: number | null
          confirmed_at?: string | null
          course_id?: string | null
          id?: string
          paid_at?: string | null
          purchase_amount?: number | null
          referred_at?: string | null
          referred_user_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_referrals_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          affiliate_code: string
          approved_at: string | null
          approved_by: string | null
          commission_rate: number | null
          created_at: string | null
          id: string
          payment_info: Json | null
          pending_payout: number | null
          status: string | null
          total_earnings: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          affiliate_code: string
          approved_at?: string | null
          approved_by?: string | null
          commission_rate?: number | null
          created_at?: string | null
          id?: string
          payment_info?: Json | null
          pending_payout?: number | null
          status?: string | null
          total_earnings?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          affiliate_code?: string
          approved_at?: string | null
          approved_by?: string | null
          commission_rate?: number | null
          created_at?: string | null
          id?: string
          payment_info?: Json | null
          pending_payout?: number | null
          status?: string | null
          total_earnings?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
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
      backlinks: {
        Row: {
          anchor_text: string | null
          discovered_at: string | null
          domain_authority: number | null
          id: string
          last_checked_at: string | null
          link_type: string | null
          notes: string | null
          source_url: string
          status: string | null
          target_url: string
        }
        Insert: {
          anchor_text?: string | null
          discovered_at?: string | null
          domain_authority?: number | null
          id?: string
          last_checked_at?: string | null
          link_type?: string | null
          notes?: string | null
          source_url: string
          status?: string | null
          target_url: string
        }
        Update: {
          anchor_text?: string | null
          discovered_at?: string | null
          domain_authority?: number | null
          id?: string
          last_checked_at?: string | null
          link_type?: string | null
          notes?: string | null
          source_url?: string
          status?: string | null
          target_url?: string
        }
        Relationships: []
      }
      beruf_dokumente: {
        Row: {
          beruf_id: string
          created_at: string
          dokument_typ: string
          gueltig_ab: string | null
          id: string
          sprache: string | null
          titel: string
          url: string
        }
        Insert: {
          beruf_id: string
          created_at?: string
          dokument_typ: string
          gueltig_ab?: string | null
          id?: string
          sprache?: string | null
          titel: string
          url: string
        }
        Update: {
          beruf_id?: string
          created_at?: string
          dokument_typ?: string
          gueltig_ab?: string | null
          id?: string
          sprache?: string | null
          titel?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "beruf_dokumente_beruf_id_fkey"
            columns: ["beruf_id"]
            isOneToOne: false
            referencedRelation: "berufe"
            referencedColumns: ["id"]
          },
        ]
      }
      berufe: {
        Row: {
          ausbildungsdauer_monate: number
          bezeichnung_kurz: string
          bezeichnung_lang: string | null
          bgbl_referenz: string | null
          bibb_id: string
          bibb_profil_url: string | null
          created_at: string
          dqr_niveau: number | null
          einsatzgebiete: Json | null
          gueltig_ab: string | null
          gueltig_bis: string | null
          id: string
          ist_aktiv: boolean
          kldb_code: string | null
          rahmenlehrplan_url: string | null
          taetigkeitsprofil: string | null
          updated_at: string
          verordnung_datum: string | null
          verordnung_pdf_url: string | null
          verordnung_titel: string | null
          zustaendigkeit: string
        }
        Insert: {
          ausbildungsdauer_monate: number
          bezeichnung_kurz: string
          bezeichnung_lang?: string | null
          bgbl_referenz?: string | null
          bibb_id: string
          bibb_profil_url?: string | null
          created_at?: string
          dqr_niveau?: number | null
          einsatzgebiete?: Json | null
          gueltig_ab?: string | null
          gueltig_bis?: string | null
          id?: string
          ist_aktiv?: boolean
          kldb_code?: string | null
          rahmenlehrplan_url?: string | null
          taetigkeitsprofil?: string | null
          updated_at?: string
          verordnung_datum?: string | null
          verordnung_pdf_url?: string | null
          verordnung_titel?: string | null
          zustaendigkeit: string
        }
        Update: {
          ausbildungsdauer_monate?: number
          bezeichnung_kurz?: string
          bezeichnung_lang?: string | null
          bgbl_referenz?: string | null
          bibb_id?: string
          bibb_profil_url?: string | null
          created_at?: string
          dqr_niveau?: number | null
          einsatzgebiete?: Json | null
          gueltig_ab?: string | null
          gueltig_bis?: string | null
          id?: string
          ist_aktiv?: boolean
          kldb_code?: string | null
          rahmenlehrplan_url?: string | null
          taetigkeitsprofil?: string | null
          updated_at?: string
          verordnung_datum?: string | null
          verordnung_pdf_url?: string | null
          verordnung_titel?: string | null
          zustaendigkeit?: string
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
      content_optimization: {
        Row: {
          analyzed_at: string | null
          content_id: string
          content_type: string
          id: string
          keyword_density: Json | null
          readability_score: number | null
          seo_score: number | null
          suggestions: Json | null
        }
        Insert: {
          analyzed_at?: string | null
          content_id: string
          content_type: string
          id?: string
          keyword_density?: Json | null
          readability_score?: number | null
          seo_score?: number | null
          suggestions?: Json | null
        }
        Update: {
          analyzed_at?: string | null
          content_id?: string
          content_type?: string
          id?: string
          keyword_density?: Json | null
          readability_score?: number | null
          seo_score?: number | null
          suggestions?: Json | null
        }
        Relationships: []
      }
      course_bundles: {
        Row: {
          bundle_price: number
          courses: string[]
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          original_price: number | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          bundle_price: number
          courses?: string[]
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          original_price?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          bundle_price?: number
          courses?: string[]
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          original_price?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
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
      course_evidence_packs: {
        Row: {
          course_id: string
          created_at: string
          curriculum_id: string
          export_version: string
          fingerprint_sha256: string
          generated_at: string
          generated_by: string | null
          id: string
          is_immutable: boolean
          notes: string | null
          pack: Json | null
          size_bytes: number | null
          storage_bucket: string | null
          storage_path: string | null
        }
        Insert: {
          course_id: string
          created_at?: string
          curriculum_id: string
          export_version?: string
          fingerprint_sha256: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          is_immutable?: boolean
          notes?: string | null
          pack?: Json | null
          size_bytes?: number | null
          storage_bucket?: string | null
          storage_path?: string | null
        }
        Update: {
          course_id?: string
          created_at?: string
          curriculum_id?: string
          export_version?: string
          fingerprint_sha256?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          is_immutable?: boolean
          notes?: string | null
          pack?: Json | null
          size_bytes?: number | null
          storage_bucket?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_evidence_packs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_evidence_packs_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
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
          beruf_id: string | null
          bibb_quelle: string | null
          created_at: string
          created_by: string | null
          curriculum_typ: string | null
          description: string | null
          extracted_data: Json | null
          frozen_at: string | null
          id: string
          kmk_version: string | null
          normalized_data: Json | null
          source_file_name: string | null
          source_file_url: string | null
          status: Database["public"]["Enums"]["curriculum_status"]
          title: string
          updated_at: string
          version: string | null
        }
        Insert: {
          beruf_id?: string | null
          bibb_quelle?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_typ?: string | null
          description?: string | null
          extracted_data?: Json | null
          frozen_at?: string | null
          id?: string
          kmk_version?: string | null
          normalized_data?: Json | null
          source_file_name?: string | null
          source_file_url?: string | null
          status?: Database["public"]["Enums"]["curriculum_status"]
          title: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          beruf_id?: string | null
          bibb_quelle?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_typ?: string | null
          description?: string | null
          extracted_data?: Json | null
          frozen_at?: string | null
          id?: string
          kmk_version?: string | null
          normalized_data?: Json | null
          source_file_name?: string | null
          source_file_url?: string | null
          status?: Database["public"]["Enums"]["curriculum_status"]
          title?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curricula_beruf_id_fkey"
            columns: ["beruf_id"]
            isOneToOne: false
            referencedRelation: "berufe"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          scheduled_at: string | null
          sent_at: string | null
          stats: Json | null
          status: string | null
          subject: string
          target_segments: string[] | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          sent_at?: string | null
          stats?: Json | null
          status?: string | null
          subject: string
          target_segments?: string[] | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          sent_at?: string | null
          stats?: Json | null
          status?: string | null
          subject?: string
          target_segments?: string[] | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          html_content: string
          id: string
          is_active: boolean | null
          name: string
          subject: string
          template_type: string
          text_content: string | null
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          html_content: string
          id?: string
          is_active?: boolean | null
          name: string
          subject: string
          template_type: string
          text_content?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          name?: string
          subject?: string
          template_type?: string
          text_content?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: []
      }
      error_patterns: {
        Row: {
          auto_fix_action: Json | null
          auto_fix_enabled: boolean | null
          error_type: string
          first_seen_at: string | null
          fix_failure_count: number | null
          fix_success_count: number | null
          id: string
          last_seen_at: string | null
          occurrences: number | null
          pattern_signature: string
        }
        Insert: {
          auto_fix_action?: Json | null
          auto_fix_enabled?: boolean | null
          error_type: string
          first_seen_at?: string | null
          fix_failure_count?: number | null
          fix_success_count?: number | null
          id?: string
          last_seen_at?: string | null
          occurrences?: number | null
          pattern_signature: string
        }
        Update: {
          auto_fix_action?: Json | null
          auto_fix_enabled?: boolean | null
          error_type?: string
          first_seen_at?: string | null
          fix_failure_count?: number | null
          fix_success_count?: number | null
          id?: string
          last_seen_at?: string | null
          occurrences?: number | null
          pattern_signature?: string
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
          {
            foreignKeyName: "exam_session_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions_safe"
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
      kpi_snapshots: {
        Row: {
          created_at: string | null
          id: string
          metrics: Json
          period_type: string | null
          snapshot_date: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          metrics?: Json
          period_type?: string | null
          snapshot_date?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          metrics?: Json
          period_type?: string | null
          snapshot_date?: string
        }
        Relationships: []
      }
      learner_notes: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          note: string
          note_type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          note: string
          note_type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          note?: string
          note_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      learner_segments: {
        Row: {
          color: string | null
          created_at: string | null
          criteria: Json
          description: string | null
          id: string
          is_dynamic: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          criteria?: Json
          description?: string | null
          id?: string
          is_dynamic?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          criteria?: Json
          description?: string | null
          id?: string
          is_dynamic?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      learner_tags: {
        Row: {
          added_at: string | null
          added_by: string | null
          id: string
          tag: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          id?: string
          tag: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          id?: string
          tag?: string
          user_id?: string
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
      lesson_outcomes: {
        Row: {
          attempts: number
          competency_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_attempt_at: string | null
          lesson_id: string
          needs_review: boolean
          score_percent: number | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          competency_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          lesson_id: string
          needs_review?: boolean
          score_percent?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          competency_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          lesson_id?: string
          needs_review?: boolean
          score_percent?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_outcomes_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_outcomes_lesson_id_fkey"
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
      newsletter_subscribers: {
        Row: {
          email: string
          first_name: string | null
          id: string
          is_subscribed: boolean | null
          last_name: string | null
          preferences: Json | null
          segments: string[] | null
          source: string | null
          subscribed_at: string | null
          unsubscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          email: string
          first_name?: string | null
          id?: string
          is_subscribed?: boolean | null
          last_name?: string | null
          preferences?: Json | null
          segments?: string[] | null
          source?: string | null
          subscribed_at?: string | null
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          email?: string
          first_name?: string | null
          id?: string
          is_subscribed?: boolean | null
          last_name?: string | null
          preferences?: Json | null
          segments?: string[] | null
          source?: string | null
          subscribed_at?: string | null
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      process_documentation: {
        Row: {
          category: string
          created_at: string | null
          created_by: string | null
          dependencies: Json | null
          description: string
          failure_handling: Json | null
          id: string
          is_active: boolean | null
          last_validated_at: string | null
          process_name: string
          steps: Json | null
          success_criteria: Json | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          category: string
          created_at?: string | null
          created_by?: string | null
          dependencies?: Json | null
          description: string
          failure_handling?: Json | null
          id?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          process_name: string
          steps?: Json | null
          success_criteria?: Json | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          category?: string
          created_at?: string | null
          created_by?: string | null
          dependencies?: Json | null
          description?: string
          failure_handling?: Json | null
          id?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          process_name?: string
          steps?: Json | null
          success_criteria?: Json | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      process_executions: {
        Row: {
          completed_at: string | null
          error_details: Json | null
          id: string
          metrics: Json | null
          process_id: string
          started_at: string | null
          status: string | null
          step_results: Json | null
        }
        Insert: {
          completed_at?: string | null
          error_details?: Json | null
          id?: string
          metrics?: Json | null
          process_id: string
          started_at?: string | null
          status?: string | null
          step_results?: Json | null
        }
        Update: {
          completed_at?: string | null
          error_details?: Json | null
          id?: string
          metrics?: Json | null
          process_id?: string
          started_at?: string | null
          status?: string | null
          step_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "process_executions_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "process_documentation"
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
      promo_code_redemptions: {
        Row: {
          course_id: string | null
          discount_applied: number
          id: string
          promo_code_id: string
          redeemed_at: string | null
          user_id: string
        }
        Insert: {
          course_id?: string | null
          discount_applied: number
          id?: string
          promo_code_id: string
          redeemed_at?: string | null
          user_id: string
        }
        Update: {
          course_id?: string | null
          discount_applied?: number
          id?: string
          promo_code_id?: string
          redeemed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_redemptions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          applicable_courses: string[] | null
          code: string
          created_at: string | null
          created_by: string | null
          current_uses: number | null
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean | null
          max_uses: number | null
          min_purchase_amount: number | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          applicable_courses?: string[] | null
          code: string
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          description?: string | null
          discount_type: string
          discount_value: number
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_purchase_amount?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          applicable_courses?: string[] | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_purchase_amount?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      recovery_actions: {
        Row: {
          action_payload: Json | null
          action_type: string
          alert_id: string | null
          created_at: string | null
          error_pattern_id: string | null
          executed_at: string | null
          id: string
          result: Json | null
          status: string | null
        }
        Insert: {
          action_payload?: Json | null
          action_type: string
          alert_id?: string | null
          created_at?: string | null
          error_pattern_id?: string | null
          executed_at?: string | null
          id?: string
          result?: Json | null
          status?: string | null
        }
        Update: {
          action_payload?: Json | null
          action_type?: string
          alert_id?: string | null
          created_at?: string | null
          error_pattern_id?: string | null
          executed_at?: string | null
          id?: string
          result?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recovery_actions_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "system_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_actions_error_pattern_id_fkey"
            columns: ["error_pattern_id"]
            isOneToOne: false
            referencedRelation: "error_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_events: {
        Row: {
          affiliate_id: string | null
          amount: number
          bundle_id: string | null
          course_id: string | null
          created_at: string | null
          currency: string | null
          event_type: string
          id: string
          metadata: Json | null
          promo_code_id: string | null
          user_id: string
        }
        Insert: {
          affiliate_id?: string | null
          amount: number
          bundle_id?: string | null
          course_id?: string | null
          created_at?: string | null
          currency?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          promo_code_id?: string | null
          user_id: string
        }
        Update: {
          affiliate_id?: string | null
          amount?: number
          bundle_id?: string | null
          course_id?: string | null
          created_at?: string | null
          currency?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          promo_code_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_events_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "course_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_settings: {
        Row: {
          canonical_url: string | null
          created_at: string | null
          id: string
          keywords: string[] | null
          meta_description: string | null
          meta_title: string | null
          og_image: string | null
          page_id: string | null
          page_type: string
          robots_directives: string | null
          structured_data: Json | null
          updated_at: string | null
        }
        Insert: {
          canonical_url?: string | null
          created_at?: string | null
          id?: string
          keywords?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          og_image?: string | null
          page_id?: string | null
          page_type: string
          robots_directives?: string | null
          structured_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          canonical_url?: string | null
          created_at?: string | null
          id?: string
          keywords?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          og_image?: string | null
          page_id?: string | null
          page_type?: string
          robots_directives?: string | null
          structured_data?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string | null
          created_at: string | null
          description: string
          id: string
          priority: string | null
          resolved_at: string | null
          status: string | null
          subject: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string | null
          description: string
          id?: string
          priority?: string | null
          resolved_at?: string | null
          status?: string | null
          subject: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string | null
          description?: string
          id?: string
          priority?: string | null
          resolved_at?: string | null
          status?: string | null
          subject?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          auto_resolved: boolean | null
          created_at: string | null
          details: Json | null
          id: string
          is_acknowledged: boolean | null
          message: string
          resolved_at: string | null
          source: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          auto_resolved?: boolean | null
          created_at?: string | null
          details?: Json | null
          id?: string
          is_acknowledged?: boolean | null
          message: string
          resolved_at?: string | null
          source: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          auto_resolved?: boolean | null
          created_at?: string | null
          details?: Json | null
          id?: string
          is_acknowledged?: boolean | null
          message?: string
          resolved_at?: string | null
          source?: string
          title?: string
        }
        Relationships: []
      }
      system_backups: {
        Row: {
          backup_type: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          size_bytes: number | null
          started_at: string | null
          status: string | null
          storage_path: string | null
          tables_included: string[] | null
        }
        Insert: {
          backup_type: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          size_bytes?: number | null
          started_at?: string | null
          status?: string | null
          storage_path?: string | null
          tables_included?: string[] | null
        }
        Update: {
          backup_type?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          size_bytes?: number | null
          started_at?: string | null
          status?: string | null
          storage_path?: string | null
          tables_included?: string[] | null
        }
        Relationships: []
      }
      system_health_checks: {
        Row: {
          check_name: string
          check_type: string
          checked_at: string | null
          details: Json | null
          id: string
          response_time_ms: number | null
          status: string | null
        }
        Insert: {
          check_name: string
          check_type: string
          checked_at?: string | null
          details?: Json | null
          id?: string
          response_time_ms?: number | null
          status?: string | null
        }
        Update: {
          check_name?: string
          check_type?: string
          checked_at?: string | null
          details?: Json | null
          id?: string
          response_time_ms?: number | null
          status?: string | null
        }
        Relationships: []
      }
      ticket_messages: {
        Row: {
          attachments: Json | null
          created_at: string | null
          id: string
          is_internal: boolean | null
          message: string
          sender_id: string
          ticket_id: string
        }
        Insert: {
          attachments?: Json | null
          created_at?: string | null
          id?: string
          is_internal?: boolean | null
          message: string
          sender_id: string
          ticket_id: string
        }
        Update: {
          attachments?: Json | null
          created_at?: string | null
          id?: string
          is_internal?: boolean | null
          message?: string
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          activity_type: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          user_agent?: string | null
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
      exam_questions_safe: {
        Row: {
          ai_generated: boolean | null
          competency_id: string | null
          created_at: string | null
          curriculum_id: string | null
          difficulty: Database["public"]["Enums"]["question_difficulty"] | null
          id: string | null
          learning_field_id: string | null
          options: Json | null
          question_text: string | null
          status: Database["public"]["Enums"]["question_status"] | null
        }
        Insert: {
          ai_generated?: boolean | null
          competency_id?: string | null
          created_at?: string | null
          curriculum_id?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null
          id?: string | null
          learning_field_id?: string | null
          options?: Json | null
          question_text?: string | null
          status?: Database["public"]["Enums"]["question_status"] | null
        }
        Update: {
          ai_generated?: boolean | null
          competency_id?: string | null
          created_at?: string | null
          curriculum_id?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null
          id?: string | null
          learning_field_id?: string | null
          options?: Json | null
          question_text?: string | null
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
      attempt_auto_recovery: { Args: { p_alert_id: string }; Returns: Json }
      calculate_daily_kpis: { Args: never; Returns: Json }
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
      course_pack_fingerprint: {
        Args: { p_course_id: string }
        Returns: string
      }
      create_course_evidence_pack: {
        Args: {
          p_course_id: string
          p_include_h5p?: boolean
          p_include_questions?: boolean
          p_notes?: string
          p_store_inline?: boolean
        }
        Returns: Json
      }
      create_job: {
        Args: {
          p_job_type: string
          p_payload: Json
          p_priority?: number
          p_run_after?: string
        }
        Returns: string
      }
      export_course_pack: {
        Args: {
          p_course_id: string
          p_include_h5p?: boolean
          p_include_questions?: boolean
        }
        Returns: Json
      }
      export_participant_pack: {
        Args: {
          p_course_id: string
          p_include_ai_logs?: boolean
          p_pseudonymize?: boolean
          p_user_id: string
        }
        Returns: Json
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
      get_course_progress: { Args: { p_course_id: string }; Returns: Json }
      get_evidence_pack: { Args: { p_pack_id: string }; Returns: Json }
      get_evidence_pack_storage_info: {
        Args: { p_pack_id: string }
        Returns: Json
      }
      get_exam_lesson_recommendations: {
        Args: { p_session_id: string }
        Returns: {
          competency_code: string
          competency_id: string
          competency_title: string
          correct_count: number
          learning_field_code: string
          learning_field_title: string
          recommended_lessons: Json
          score_percent: number
          total_count: number
        }[]
      }
      get_lessons_needing_review: {
        Args: { p_course_id?: string }
        Returns: {
          attempts: number
          competency_title: string
          last_attempt_at: string
          lesson_id: string
          lesson_title: string
          module_title: string
          score_percent: number
        }[]
      }
      get_user_dashboard_stats: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      job_maintenance: { Args: never; Returns: Json }
      list_course_evidence_packs: {
        Args: {
          p_course_id?: string
          p_curriculum_id?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          course_id: string
          curriculum_id: string
          export_version: string
          fingerprint_sha256: string
          generated_at: string
          generated_by: string
          has_inline_pack: boolean
          id: string
          notes: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
        }[]
      }
      list_latest_evidence_packs: {
        Args: { p_limit?: number }
        Returns: {
          course_id: string
          course_title: string
          curriculum_id: string
          curriculum_title: string
          fingerprint_sha256: string
          generated_at: string
          latest_pack_id: string
          pack_count: number
          size_bytes: number
          storage_bucket: string
          storage_path: string
        }[]
      }
      record_worker_usage: {
        Args: {
          p_cost_eur?: number
          p_is_error?: boolean
          p_job_type: string
          p_tokens_used?: number
        }
        Returns: undefined
      }
      register_course_evidence_pack: {
        Args: {
          p_course_id: string
          p_export_version: string
          p_fingerprint_sha256: string
          p_size_bytes?: number
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: {
          course_id: string
          created_at: string
          curriculum_id: string
          export_version: string
          fingerprint_sha256: string
          generated_at: string
          generated_by: string | null
          id: string
          is_immutable: boolean
          notes: string | null
          pack: Json | null
          size_bytes: number | null
          storage_bucket: string | null
          storage_path: string | null
        }
        SetofOptions: {
          from: "*"
          to: "course_evidence_packs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      requeue_failed_jobs: { Args: never; Returns: number }
      run_health_checks: { Args: never; Returns: Json }
      start_exam_session: {
        Args: { p_blueprint_id: string; p_mode?: string }
        Returns: string
      }
      start_lesson: {
        Args: { p_lesson_id: string }
        Returns: {
          attempts: number
          competency_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_attempt_at: string | null
          lesson_id: string
          needs_review: boolean
          score_percent: number | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lesson_outcomes"
          isOneToOne: true
          isSetofReturn: false
        }
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
      update_lesson_outcome: {
        Args: { p_lesson_id: string; p_score_percent: number }
        Returns: {
          attempts: number
          competency_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_attempt_at: string | null
          lesson_id: string
          needs_review: boolean
          score_percent: number | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lesson_outcomes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_evidence_pack_integrity: {
        Args: { p_pack_id: string }
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
