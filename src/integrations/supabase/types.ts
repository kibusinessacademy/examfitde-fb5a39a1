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
      ai_cost_budgets: {
        Row: {
          alert_sent_at: string | null
          alert_threshold: number
          budget_eur: number
          created_at: string
          id: string
          month: string
          spent_eur: number
          updated_at: string
        }
        Insert: {
          alert_sent_at?: string | null
          alert_threshold?: number
          budget_eur?: number
          created_at?: string
          id?: string
          month: string
          spent_eur?: number
          updated_at?: string
        }
        Update: {
          alert_sent_at?: string | null
          alert_threshold?: number
          budget_eur?: number
          created_at?: string
          id?: string
          month?: string
          spent_eur?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_generations: {
        Row: {
          cost_eur: number | null
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_type: string
          generator_model: string
          id: string
          input_context: Json | null
          input_tokens: number | null
          latency_ms: number | null
          metadata: Json | null
          output_content: Json
          output_tokens: number | null
          prompt_hash: string | null
          status: string
          validation_decision: string | null
          validation_score: number | null
        }
        Insert: {
          cost_eur?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type: string
          generator_model: string
          id?: string
          input_context?: Json | null
          input_tokens?: number | null
          latency_ms?: number | null
          metadata?: Json | null
          output_content: Json
          output_tokens?: number | null
          prompt_hash?: string | null
          status?: string
          validation_decision?: string | null
          validation_score?: number | null
        }
        Update: {
          cost_eur?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string
          generator_model?: string
          id?: string
          input_context?: Json | null
          input_tokens?: number | null
          latency_ms?: number | null
          metadata?: Json | null
          output_content?: Json
          output_tokens?: number | null
          prompt_hash?: string | null
          status?: string
          validation_decision?: string | null
          validation_score?: number | null
        }
        Relationships: []
      }
      ai_quality_gates: {
        Row: {
          actual_score: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          gate_status: string
          gate_type: string
          generation_id: string
          id: string
          metadata: Json | null
          reason: string | null
          required_score: number | null
        }
        Insert: {
          actual_score?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          gate_status?: string
          gate_type: string
          generation_id: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          required_score?: number | null
        }
        Update: {
          actual_score?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          gate_status?: string
          gate_type?: string
          generation_id?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          required_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_quality_gates_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id"]
          },
        ]
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
      ai_usage_log: {
        Row: {
          cost_eur: number
          created_at: string
          error_message: string | null
          id: string
          input_tokens: number
          job_type: string
          latency_ms: number | null
          metadata: Json | null
          model: string | null
          output_tokens: number
          success: boolean
          total_tokens: number | null
        }
        Insert: {
          cost_eur?: number
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number
          job_type: string
          latency_ms?: number | null
          metadata?: Json | null
          model?: string | null
          output_tokens?: number
          success?: boolean
          total_tokens?: number | null
        }
        Update: {
          cost_eur?: number
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number
          job_type?: string
          latency_ms?: number | null
          metadata?: Json | null
          model?: string | null
          output_tokens?: number
          success?: boolean
          total_tokens?: number | null
        }
        Relationships: []
      }
      ai_validation_rules: {
        Row: {
          created_at: string
          dimension: string
          entity_type: string
          id: string
          is_active: boolean | null
          is_critical: boolean | null
          min_score: number | null
          prompt_template: string | null
          rule_description: string | null
          rule_name: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          dimension: string
          entity_type: string
          id?: string
          is_active?: boolean | null
          is_critical?: boolean | null
          min_score?: number | null
          prompt_template?: string | null
          rule_description?: string | null
          rule_name: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          dimension?: string
          entity_type?: string
          id?: string
          is_active?: boolean | null
          is_critical?: boolean | null
          min_score?: number | null
          prompt_template?: string | null
          rule_description?: string | null
          rule_name?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      ai_validations: {
        Row: {
          corrected_content: Json | null
          cost_eur: number | null
          critical_issues: Json | null
          decision: string
          dimension_scores: Json
          generation_id: string
          id: string
          improvements: string[] | null
          input_tokens: number | null
          latency_ms: number | null
          metadata: Json | null
          output_tokens: number | null
          overall_score: number
          suggested_fixes: Json | null
          validated_at: string
          validated_by: string | null
          validation_mode: string
          validator_model: string
        }
        Insert: {
          corrected_content?: Json | null
          cost_eur?: number | null
          critical_issues?: Json | null
          decision: string
          dimension_scores?: Json
          generation_id: string
          id?: string
          improvements?: string[] | null
          input_tokens?: number | null
          latency_ms?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          overall_score: number
          suggested_fixes?: Json | null
          validated_at?: string
          validated_by?: string | null
          validation_mode?: string
          validator_model?: string
        }
        Update: {
          corrected_content?: Json | null
          cost_eur?: number | null
          critical_issues?: Json | null
          decision?: string
          dimension_scores?: Json
          generation_id?: string
          id?: string
          improvements?: string[] | null
          input_tokens?: number | null
          latency_ms?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          overall_score?: number
          suggested_fixes?: Json | null
          validated_at?: string
          validated_by?: string | null
          validation_mode?: string
          validator_model?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_validations_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
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
      azav_audit_log: {
        Row: {
          audit_date: string
          audit_type: string
          auditor_name: string | null
          auditor_organization: string | null
          corrective_actions: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          findings: Json | null
          id: string
          massnahme_id: string | null
          overall_result: string | null
          qm_document_id: string | null
          score: number | null
          title: string
          verification_date: string | null
          verification_status: string | null
        }
        Insert: {
          audit_date?: string
          audit_type: string
          auditor_name?: string | null
          auditor_organization?: string | null
          corrective_actions?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          findings?: Json | null
          id?: string
          massnahme_id?: string | null
          overall_result?: string | null
          qm_document_id?: string | null
          score?: number | null
          title: string
          verification_date?: string | null
          verification_status?: string | null
        }
        Update: {
          audit_date?: string
          audit_type?: string
          auditor_name?: string | null
          auditor_organization?: string | null
          corrective_actions?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          findings?: Json | null
          id?: string
          massnahme_id?: string | null
          overall_result?: string | null
          qm_document_id?: string | null
          score?: number | null
          title?: string
          verification_date?: string | null
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "azav_audit_log_massnahme_id_fkey"
            columns: ["massnahme_id"]
            isOneToOne: false
            referencedRelation: "azav_massnahmen_zulassungen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "azav_audit_log_qm_document_id_fkey"
            columns: ["qm_document_id"]
            isOneToOne: false
            referencedRelation: "qm_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      azav_compliance_checks: {
        Row: {
          automated_query: string | null
          check_category: string
          check_code: string
          check_description: string | null
          check_name: string
          created_at: string
          expected_result: string | null
          id: string
          is_automated: boolean | null
          priority: string | null
          sgb_referenz: string | null
          weight: number | null
        }
        Insert: {
          automated_query?: string | null
          check_category: string
          check_code: string
          check_description?: string | null
          check_name: string
          created_at?: string
          expected_result?: string | null
          id?: string
          is_automated?: boolean | null
          priority?: string | null
          sgb_referenz?: string | null
          weight?: number | null
        }
        Update: {
          automated_query?: string | null
          check_category?: string
          check_code?: string
          check_description?: string | null
          check_name?: string
          created_at?: string
          expected_result?: string | null
          id?: string
          is_automated?: boolean | null
          priority?: string | null
          sgb_referenz?: string | null
          weight?: number | null
        }
        Relationships: []
      }
      azav_compliance_results: {
        Row: {
          actual_value: string | null
          check_date: string
          check_id: string
          checked_by: string | null
          created_at: string
          evidence_url: string | null
          id: string
          massnahme_id: string | null
          notes: string | null
          result: string
        }
        Insert: {
          actual_value?: string | null
          check_date?: string
          check_id: string
          checked_by?: string | null
          created_at?: string
          evidence_url?: string | null
          id?: string
          massnahme_id?: string | null
          notes?: string | null
          result: string
        }
        Update: {
          actual_value?: string | null
          check_date?: string
          check_id?: string
          checked_by?: string | null
          created_at?: string
          evidence_url?: string | null
          id?: string
          massnahme_id?: string | null
          notes?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "azav_compliance_results_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "azav_compliance_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "azav_compliance_results_massnahme_id_fkey"
            columns: ["massnahme_id"]
            isOneToOne: false
            referencedRelation: "azav_massnahmen_zulassungen"
            referencedColumns: ["id"]
          },
        ]
      }
      azav_fachbereiche: {
        Row: {
          beschreibung: string | null
          bezeichnung: string
          created_at: string
          fachbereich_nummer: number
          fachkundige_stelle: string | null
          id: string
          is_active: boolean | null
          massnahmen_beispiele: Json | null
          sgb_referenz: string | null
          updated_at: string
          zertifikat_nummer: string | null
          zulassung_bis: string | null
          zulassung_datum: string | null
        }
        Insert: {
          beschreibung?: string | null
          bezeichnung: string
          created_at?: string
          fachbereich_nummer: number
          fachkundige_stelle?: string | null
          id?: string
          is_active?: boolean | null
          massnahmen_beispiele?: Json | null
          sgb_referenz?: string | null
          updated_at?: string
          zertifikat_nummer?: string | null
          zulassung_bis?: string | null
          zulassung_datum?: string | null
        }
        Update: {
          beschreibung?: string | null
          bezeichnung?: string
          created_at?: string
          fachbereich_nummer?: number
          fachkundige_stelle?: string | null
          id?: string
          is_active?: boolean | null
          massnahmen_beispiele?: Json | null
          sgb_referenz?: string | null
          updated_at?: string
          zertifikat_nummer?: string | null
          zulassung_bis?: string | null
          zulassung_datum?: string | null
        }
        Relationships: []
      }
      azav_massnahmen_zulassungen: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          curriculum_id: string
          dozenten_qualifikationen: Json | null
          fachbereich_id: string
          fachkundige_stelle: string | null
          id: string
          kosten_pro_teilnehmer: number | null
          lehrgangsunterlagen_url: string | null
          lernform: string | null
          massnahmen_dauer_wochen: number | null
          massnahmen_konzept_url: string | null
          massnahmen_nummer: string | null
          max_teilnehmer: number | null
          notes: string | null
          unterrichtseinheiten_gesamt: number | null
          unterrichtseinheiten_pro_woche: number | null
          updated_at: string
          zertifikat_nummer: string | null
          zulassung_bis: string | null
          zulassung_datum: string | null
          zulassung_status: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          curriculum_id: string
          dozenten_qualifikationen?: Json | null
          fachbereich_id: string
          fachkundige_stelle?: string | null
          id?: string
          kosten_pro_teilnehmer?: number | null
          lehrgangsunterlagen_url?: string | null
          lernform?: string | null
          massnahmen_dauer_wochen?: number | null
          massnahmen_konzept_url?: string | null
          massnahmen_nummer?: string | null
          max_teilnehmer?: number | null
          notes?: string | null
          unterrichtseinheiten_gesamt?: number | null
          unterrichtseinheiten_pro_woche?: number | null
          updated_at?: string
          zertifikat_nummer?: string | null
          zulassung_bis?: string | null
          zulassung_datum?: string | null
          zulassung_status?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          curriculum_id?: string
          dozenten_qualifikationen?: Json | null
          fachbereich_id?: string
          fachkundige_stelle?: string | null
          id?: string
          kosten_pro_teilnehmer?: number | null
          lehrgangsunterlagen_url?: string | null
          lernform?: string | null
          massnahmen_dauer_wochen?: number | null
          massnahmen_konzept_url?: string | null
          massnahmen_nummer?: string | null
          max_teilnehmer?: number | null
          notes?: string | null
          unterrichtseinheiten_gesamt?: number | null
          unterrichtseinheiten_pro_woche?: number | null
          updated_at?: string
          zertifikat_nummer?: string | null
          zulassung_bis?: string | null
          zulassung_datum?: string | null
          zulassung_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "azav_massnahmen_zulassungen_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "azav_massnahmen_zulassungen_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "azav_massnahmen_zulassungen_fachbereich_id_fkey"
            columns: ["fachbereich_id"]
            isOneToOne: false
            referencedRelation: "azav_fachbereiche"
            referencedColumns: ["id"]
          },
        ]
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
      beruf_aliases: {
        Row: {
          alias: string
          alias_norm: string
          beruf_id: string
          created_at: string
          id: string
          priority: number
        }
        Insert: {
          alias: string
          alias_norm: string
          beruf_id: string
          created_at?: string
          id?: string
          priority?: number
        }
        Update: {
          alias?: string
          alias_norm?: string
          beruf_id?: string
          created_at?: string
          id?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "beruf_aliases_beruf_id_fkey"
            columns: ["beruf_id"]
            isOneToOne: false
            referencedRelation: "berufe"
            referencedColumns: ["id"]
          },
        ]
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
      blueprint_audit_log: {
        Row: {
          action: string
          affected_variants_count: number | null
          blueprint_id: string
          change_reason: string | null
          changes: Json | null
          id: string
          new_version: string | null
          old_version: string | null
          performed_at: string
          performed_by: string | null
        }
        Insert: {
          action: string
          affected_variants_count?: number | null
          blueprint_id: string
          change_reason?: string | null
          changes?: Json | null
          id?: string
          new_version?: string | null
          old_version?: string | null
          performed_at?: string
          performed_by?: string | null
        }
        Update: {
          action?: string
          affected_variants_count?: number | null
          blueprint_id?: string
          change_reason?: string | null
          changes?: Json | null
          id?: string
          new_version?: string | null
          old_version?: string | null
          performed_at?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_audit_log_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "blueprint_audit_log_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_constraints: {
        Row: {
          action_expression: Json
          blueprint_id: string
          condition_expression: Json
          constraint_type: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          priority: number | null
        }
        Insert: {
          action_expression: Json
          blueprint_id: string
          condition_expression: Json
          constraint_type: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          priority?: number | null
        }
        Update: {
          action_expression?: Json
          blueprint_id?: string
          condition_expression?: Json
          constraint_type?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          priority?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_constraints_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "blueprint_constraints_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_correct_answers: {
        Row: {
          answer_template: string
          blueprint_id: string
          calculation_formula: string | null
          created_at: string
          id: string
          is_primary: boolean
        }
        Insert: {
          answer_template: string
          blueprint_id: string
          calculation_formula?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          answer_template?: string
          blueprint_id?: string
          calculation_formula?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_correct_answers_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "blueprint_correct_answers_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_distractors: {
        Row: {
          blueprint_id: string
          created_at: string
          distractor_template: string
          error_explanation: string | null
          error_type: Database["public"]["Enums"]["distractor_error_type"]
          id: string
          is_active: boolean
          sort_order: number | null
        }
        Insert: {
          blueprint_id: string
          created_at?: string
          distractor_template: string
          error_explanation?: string | null
          error_type: Database["public"]["Enums"]["distractor_error_type"]
          id?: string
          is_active?: boolean
          sort_order?: number | null
        }
        Update: {
          blueprint_id?: string
          created_at?: string
          distractor_template?: string
          error_explanation?: string | null
          error_type?: Database["public"]["Enums"]["distractor_error_type"]
          id?: string
          is_active?: boolean
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_distractors_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "blueprint_distractors_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_variables: {
        Row: {
          allowed_values: string[] | null
          blueprint_id: string
          created_at: string
          default_value: string | null
          id: string
          is_required: boolean
          range_max: number | null
          range_min: number | null
          range_step: number | null
          text_pattern: string | null
          variable_name: string
          variable_type: string
        }
        Insert: {
          allowed_values?: string[] | null
          blueprint_id: string
          created_at?: string
          default_value?: string | null
          id?: string
          is_required?: boolean
          range_max?: number | null
          range_min?: number | null
          range_step?: number | null
          text_pattern?: string | null
          variable_name: string
          variable_type: string
        }
        Update: {
          allowed_values?: string[] | null
          blueprint_id?: string
          created_at?: string
          default_value?: string | null
          id?: string
          is_required?: boolean
          range_max?: number | null
          range_min?: number | null
          range_step?: number | null
          text_pattern?: string | null
          variable_name?: string
          variable_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_variables_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "blueprint_variables_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_variants: {
        Row: {
          blueprint_id: string
          exam_question_id: string | null
          generated_at: string
          generated_by: string | null
          generation_seed: number | null
          id: string
          similarity_score: number | null
          validation_errors: string[] | null
          validation_passed: boolean
          variable_values: Json
        }
        Insert: {
          blueprint_id: string
          exam_question_id?: string | null
          generated_at?: string
          generated_by?: string | null
          generation_seed?: number | null
          id?: string
          similarity_score?: number | null
          validation_errors?: string[] | null
          validation_passed?: boolean
          variable_values: Json
        }
        Update: {
          blueprint_id?: string
          exam_question_id?: string | null
          generated_at?: string
          generated_by?: string | null
          generation_seed?: number | null
          id?: string
          similarity_score?: number | null
          validation_errors?: string[] | null
          validation_passed?: boolean
          variable_values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_variants_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "blueprint_variants_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprint_variants_exam_question_id_fkey"
            columns: ["exam_question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprint_variants_exam_question_id_fkey"
            columns: ["exam_question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      churn_predictions: {
        Row: {
          action_taken: string | null
          action_taken_at: string | null
          expires_at: string | null
          id: string
          predicted_at: string
          recommended_action: string | null
          risk_level: string
          risk_score: number
          signals: Json | null
          user_id: string
        }
        Insert: {
          action_taken?: string | null
          action_taken_at?: string | null
          expires_at?: string | null
          id?: string
          predicted_at?: string
          recommended_action?: string | null
          risk_level?: string
          risk_score?: number
          signals?: Json | null
          user_id: string
        }
        Update: {
          action_taken?: string | null
          action_taken_at?: string | null
          expires_at?: string | null
          id?: string
          predicted_at?: string
          recommended_action?: string | null
          risk_level?: string
          risk_score?: number
          signals?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: Json | null
          admin_user_id: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          max_seats: number | null
          name: string
          updated_at: string
          vat_id: string | null
        }
        Insert: {
          address?: Json | null
          admin_user_id: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          max_seats?: number | null
          name: string
          updated_at?: string
          vat_id?: string | null
        }
        Update: {
          address?: Json | null
          admin_user_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          max_seats?: number | null
          name?: string
          updated_at?: string
          vat_id?: string | null
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
      content_effectiveness: {
        Row: {
          abort_rate: number | null
          avg_time_minutes: number | null
          calculated_at: string
          classification: string | null
          entity_id: string
          entity_title: string | null
          entity_type: string
          id: string
          mastery_rate: number | null
          readiness_impact: number | null
          support_tickets_generated: number | null
          usage_count: number | null
        }
        Insert: {
          abort_rate?: number | null
          avg_time_minutes?: number | null
          calculated_at?: string
          classification?: string | null
          entity_id: string
          entity_title?: string | null
          entity_type: string
          id?: string
          mastery_rate?: number | null
          readiness_impact?: number | null
          support_tickets_generated?: number | null
          usage_count?: number | null
        }
        Update: {
          abort_rate?: number | null
          avg_time_minutes?: number | null
          calculated_at?: string
          classification?: string | null
          entity_id?: string
          entity_title?: string | null
          entity_type?: string
          id?: string
          mastery_rate?: number | null
          readiness_impact?: number | null
          support_tickets_generated?: number | null
          usage_count?: number | null
        }
        Relationships: []
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
      controlling_snapshots: {
        Row: {
          created_at: string
          dimension: string | null
          dimension_id: string | null
          id: string
          kpi_type: string
          kpi_value: number
          metadata: Json | null
          snapshot_date: string
        }
        Insert: {
          created_at?: string
          dimension?: string | null
          dimension_id?: string | null
          id?: string
          kpi_type: string
          kpi_value: number
          metadata?: Json | null
          snapshot_date?: string
        }
        Update: {
          created_at?: string
          dimension?: string | null
          dimension_id?: string | null
          id?: string
          kpi_type?: string
          kpi_value?: number
          metadata?: Json | null
          snapshot_date?: string
        }
        Relationships: []
      }
      council_activity_log: {
        Row: {
          action: string
          agent_role: string | null
          cost_eur: number | null
          council_id: string
          created_at: string
          duration_ms: number | null
          id: string
          input_summary: string | null
          llm_model: string | null
          metadata: Json | null
          output_summary: string | null
        }
        Insert: {
          action: string
          agent_role?: string | null
          cost_eur?: number | null
          council_id: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_summary?: string | null
          llm_model?: string | null
          metadata?: Json | null
          output_summary?: string | null
        }
        Update: {
          action?: string
          agent_role?: string | null
          cost_eur?: number | null
          council_id?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_summary?: string | null
          llm_model?: string | null
          metadata?: Json | null
          output_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "council_activity_log_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      council_automations: {
        Row: {
          automation_key: string
          config: Json
          council_id: string
          created_at: string
          enabled: boolean
          id: string
          last_result: Json | null
          last_run_at: string | null
          updated_at: string
        }
        Insert: {
          automation_key: string
          config?: Json
          council_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_result?: Json | null
          last_run_at?: string | null
          updated_at?: string
        }
        Update: {
          automation_key?: string
          config?: Json
          council_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_result?: Json | null
          last_run_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      council_autopilot_settings: {
        Row: {
          allowed_actions: Json
          council_id: string
          created_at: string
          enabled: boolean
          max_daily_actions: number
          requires_approval_above_risk: string
          risk_threshold: string
          updated_at: string
        }
        Insert: {
          allowed_actions?: Json
          council_id: string
          created_at?: string
          enabled?: boolean
          max_daily_actions?: number
          requires_approval_above_risk?: string
          risk_threshold?: string
          updated_at?: string
        }
        Update: {
          allowed_actions?: Json
          council_id?: string
          created_at?: string
          enabled?: boolean
          max_daily_actions?: number
          requires_approval_above_risk?: string
          risk_threshold?: string
          updated_at?: string
        }
        Relationships: []
      }
      council_decisions: {
        Row: {
          approvals: Json | null
          council_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_type: string
          description: string | null
          id: string
          payload: Json | null
          requires_councils: string[] | null
          status: string
          title: string
        }
        Insert: {
          approvals?: Json | null
          council_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_type: string
          description?: string | null
          id?: string
          payload?: Json | null
          requires_councils?: string[] | null
          status?: string
          title: string
        }
        Update: {
          approvals?: Json | null
          council_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_type?: string
          description?: string | null
          id?: string
          payload?: Json | null
          requires_councils?: string[] | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "council_decisions_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      council_escalations: {
        Row: {
          created_at: string
          description: string | null
          escalation_type: string
          id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_council_id: string
          status: string
          target_council_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          escalation_type: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_council_id: string
          status?: string
          target_council_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          escalation_type?: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_council_id?: string
          status?: string
          target_council_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "council_escalations_source_council_id_fkey"
            columns: ["source_council_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "council_escalations_target_council_id_fkey"
            columns: ["target_council_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      council_events: {
        Row: {
          actor_user_id: string | null
          council_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          actor_user_id?: string | null
          council_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          actor_user_id?: string | null
          council_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      council_kill_switches: {
        Row: {
          action: string
          council_id: string
          created_at: string
          id: string
          is_active: boolean | null
          kpi_name: string
          last_triggered_at: string | null
          operator: string
          rule_name: string
          threshold: number
          trigger_count: number | null
        }
        Insert: {
          action?: string
          council_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          kpi_name: string
          last_triggered_at?: string | null
          operator: string
          rule_name: string
          threshold: number
          trigger_count?: number | null
        }
        Update: {
          action?: string
          council_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          kpi_name?: string
          last_triggered_at?: string | null
          operator?: string
          rule_name?: string
          threshold?: number
          trigger_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "council_kill_switches_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      council_kpis: {
        Row: {
          council_id: string
          id: string
          kpi_name: string
          kpi_value: number | null
          measured_at: string
          metadata: Json | null
          period: string
          status: string | null
          target_value: number | null
          unit: string | null
        }
        Insert: {
          council_id: string
          id?: string
          kpi_name: string
          kpi_value?: number | null
          measured_at?: string
          metadata?: Json | null
          period?: string
          status?: string | null
          target_value?: number | null
          unit?: string | null
        }
        Update: {
          council_id?: string
          id?: string
          kpi_name?: string
          kpi_value?: number | null
          measured_at?: string
          metadata?: Json | null
          period?: string
          status?: string | null
          target_value?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "council_kpis_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      council_recommendations: {
        Row: {
          council_id: string
          created_at: string
          details: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          impact: string
          risk: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          council_id: string
          created_at?: string
          details?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          impact?: string
          risk?: string
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          council_id?: string
          created_at?: string
          details?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          impact?: string
          risk?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      council_states: {
        Row: {
          council_id: string
          created_at: string
          is_paused: boolean
          kill_switch: boolean
          last_snapshot: Json | null
          last_snapshot_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          council_id: string
          created_at?: string
          is_paused?: boolean
          kill_switch?: boolean
          last_snapshot?: Json | null
          last_snapshot_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          council_id?: string
          created_at?: string
          is_paused?: boolean
          kill_switch?: boolean
          last_snapshot?: Json | null
          last_snapshot_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      councils: {
        Row: {
          budget_eur_monthly: number | null
          budget_spent_eur: number | null
          config: Json | null
          created_at: string
          generator_model: string | null
          id: string
          mission: string
          name: string
          producer_model: string | null
          status: string
          updated_at: string
          validator_model: string | null
        }
        Insert: {
          budget_eur_monthly?: number | null
          budget_spent_eur?: number | null
          config?: Json | null
          created_at?: string
          generator_model?: string | null
          id: string
          mission: string
          name: string
          producer_model?: string | null
          status?: string
          updated_at?: string
          validator_model?: string | null
        }
        Update: {
          budget_eur_monthly?: number | null
          budget_spent_eur?: number | null
          config?: Json | null
          created_at?: string
          generator_model?: string | null
          id?: string
          mission?: string
          name?: string
          producer_model?: string | null
          status?: string
          updated_at?: string
          validator_model?: string | null
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
      course_health_snapshots: {
        Row: {
          avg_word_count: number
          benchmarks: Json | null
          competency_count: number
          course_id: string
          covered_competency_count: number
          created_at: string
          duplicate_titles: number
          empty_content_count: number
          health_score: number
          health_status: string
          id: string
          issues: Json | null
          lesson_count: number
          snapshot_type: string
          step_distribution: Json | null
        }
        Insert: {
          avg_word_count?: number
          benchmarks?: Json | null
          competency_count?: number
          course_id: string
          covered_competency_count?: number
          created_at?: string
          duplicate_titles?: number
          empty_content_count?: number
          health_score?: number
          health_status?: string
          id?: string
          issues?: Json | null
          lesson_count?: number
          snapshot_type?: string
          step_distribution?: Json | null
        }
        Update: {
          avg_word_count?: number
          benchmarks?: Json | null
          competency_count?: number
          course_id?: string
          covered_competency_count?: number
          created_at?: string
          duplicate_titles?: number
          empty_content_count?: number
          health_score?: number
          health_status?: string
          id?: string
          issues?: Json | null
          lesson_count?: number
          snapshot_type?: string
          step_distribution?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "course_health_snapshots_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_notes: {
        Row: {
          content: string
          course_id: string | null
          created_at: string
          id: string
          is_flagged_for_repeat: boolean
          lesson_id: string | null
          note_type: string
          question_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          course_id?: string | null
          created_at?: string
          id?: string
          is_flagged_for_repeat?: boolean
          lesson_id?: string | null
          note_type?: string
          question_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          course_id?: string | null
          created_at?: string
          id?: string
          is_flagged_for_repeat?: boolean
          lesson_id?: string | null
          note_type?: string
          question_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_notes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_quality_audits: {
        Row: {
          audit_type: string
          audited_at: string
          audited_by: string
          course_id: string
          created_at: string
          critical_issues: Json
          dimensions: Json
          id: string
          lesson_audits: Json
          model_used: string | null
          overall_grade: string
          overall_score: number
          recommendations: Json
        }
        Insert: {
          audit_type?: string
          audited_at?: string
          audited_by?: string
          course_id: string
          created_at?: string
          critical_issues?: Json
          dimensions?: Json
          id?: string
          lesson_audits?: Json
          model_used?: string | null
          overall_grade?: string
          overall_score?: number
          recommendations?: Json
        }
        Update: {
          audit_type?: string
          audited_at?: string
          audited_by?: string
          course_id?: string
          created_at?: string
          critical_issues?: Json
          dimensions?: Json
          id?: string
          lesson_audits?: Json
          model_used?: string | null
          overall_grade?: string
          overall_score?: number
          recommendations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "course_quality_audits_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_reviews: {
        Row: {
          content: string | null
          course_id: string
          created_at: string
          helpful_count: number
          id: string
          is_verified_purchase: boolean
          rating: number
          reported_count: number
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string | null
          course_id: string
          created_at?: string
          helpful_count?: number
          id?: string
          is_verified_purchase?: boolean
          rating: number
          reported_count?: number
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string | null
          course_id?: string
          created_at?: string
          helpful_count?: number
          id?: string
          is_verified_purchase?: boolean
          rating?: number
          reported_count?: number
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_reviews_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          autopilot_runner_id: string | null
          autopilot_sealed_at: string | null
          autopilot_started_at: string | null
          autopilot_status: string
          created_at: string
          created_by: string | null
          curriculum_id: string
          description: string | null
          estimated_duration: number | null
          id: string
          published_at: string | null
          publishing_status: string | null
          quality_report: Json | null
          quality_score: number | null
          status: Database["public"]["Enums"]["course_status"]
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          autopilot_runner_id?: string | null
          autopilot_sealed_at?: string | null
          autopilot_started_at?: string | null
          autopilot_status?: string
          created_at?: string
          created_by?: string | null
          curriculum_id: string
          description?: string | null
          estimated_duration?: number | null
          id?: string
          published_at?: string | null
          publishing_status?: string | null
          quality_report?: Json | null
          quality_score?: number | null
          status?: Database["public"]["Enums"]["course_status"]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          autopilot_runner_id?: string | null
          autopilot_sealed_at?: string | null
          autopilot_started_at?: string | null
          autopilot_status?: string
          created_at?: string
          created_by?: string | null
          curriculum_id?: string
          description?: string | null
          estimated_duration?: number | null
          id?: string
          published_at?: string | null
          publishing_status?: string | null
          quality_report?: Json | null
          quality_score?: number | null
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
          import_log: Json | null
          import_source: string | null
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
          import_log?: Json | null
          import_source?: string | null
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
          import_log?: Json | null
          import_source?: string | null
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
      curriculum_products: {
        Row: {
          blueprint_id: string | null
          course_id: string | null
          created_at: string
          created_by: string | null
          curriculum_id: string
          generated_at: string | null
          generation_error: string | null
          generation_status: string
          id: string
          is_published: boolean
          product_id: string
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          blueprint_id?: string | null
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_id: string
          generated_at?: string | null
          generation_error?: string | null
          generation_status?: string
          id?: string
          is_published?: boolean
          product_id: string
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          blueprint_id?: string | null
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_id?: string
          generated_at?: string | null
          generation_error?: string | null
          generation_status?: string
          id?: string
          is_published?: boolean
          product_id?: string
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_products_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "exam_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_products_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_products_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_items: {
        Row: {
          council_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          description: string | null
          effort_score: number
          id: string
          impact_score: number
          payload: Json
          priority_score: number
          requires_approval: boolean
          risk_score: number
          source_id: string | null
          source_type: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          council_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description?: string | null
          effort_score?: number
          id?: string
          impact_score?: number
          payload?: Json
          priority_score?: number
          requires_approval?: boolean
          risk_score?: number
          source_id?: string | null
          source_type?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          council_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description?: string | null
          effort_score?: number
          id?: string
          impact_score?: number
          payload?: Json
          priority_score?: number
          requires_approval?: boolean
          risk_score?: number
          source_id?: string | null
          source_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      disallowed_keywords: {
        Row: {
          category: string | null
          created_at: string
          curriculum_id: string
          id: string
          keyword: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          curriculum_id: string
          id?: string
          keyword: string
        }
        Update: {
          category?: string | null
          created_at?: string
          curriculum_id?: string
          id?: string
          keyword?: string
        }
        Relationships: [
          {
            foreignKeyName: "disallowed_keywords_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
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
      entitlements: {
        Row: {
          created_at: string | null
          curriculum_id: string
          has_ai_tutor: boolean | null
          has_exam_trainer: boolean | null
          has_learning_course: boolean | null
          has_oral_trainer: boolean | null
          id: string
          seat_id: string | null
          user_id: string
          valid_from: string | null
          valid_until: string
        }
        Insert: {
          created_at?: string | null
          curriculum_id: string
          has_ai_tutor?: boolean | null
          has_exam_trainer?: boolean | null
          has_learning_course?: boolean | null
          has_oral_trainer?: boolean | null
          id?: string
          seat_id?: string | null
          user_id: string
          valid_from?: string | null
          valid_until: string
        }
        Update: {
          created_at?: string | null
          curriculum_id?: string
          has_ai_tutor?: boolean | null
          has_exam_trainer?: boolean | null
          has_learning_course?: boolean | null
          has_oral_trainer?: boolean | null
          id?: string
          seat_id?: string | null
          user_id?: string
          valid_from?: string | null
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "license_seats"
            referencedColumns: ["id"]
          },
        ]
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
      exam_anxiety_sessions: {
        Row: {
          anxiety_after: number | null
          anxiety_before: number | null
          breathing_pattern: string | null
          breathing_rounds: number | null
          checklist_items_completed: number | null
          checklist_items_total: number | null
          completed_at: string | null
          duration_seconds: number | null
          id: string
          session_type: string
          started_at: string
          user_id: string
          user_notes: string | null
          visualization_duration_seconds: number | null
          visualization_theme: string | null
        }
        Insert: {
          anxiety_after?: number | null
          anxiety_before?: number | null
          breathing_pattern?: string | null
          breathing_rounds?: number | null
          checklist_items_completed?: number | null
          checklist_items_total?: number | null
          completed_at?: string | null
          duration_seconds?: number | null
          id?: string
          session_type: string
          started_at?: string
          user_id: string
          user_notes?: string | null
          visualization_duration_seconds?: number | null
          visualization_theme?: string | null
        }
        Update: {
          anxiety_after?: number | null
          anxiety_before?: number | null
          breathing_pattern?: string | null
          breathing_rounds?: number | null
          checklist_items_completed?: number | null
          checklist_items_total?: number | null
          completed_at?: string | null
          duration_seconds?: number | null
          id?: string
          session_type?: string
          started_at?: string
          user_id?: string
          user_notes?: string | null
          visualization_duration_seconds?: number | null
          visualization_theme?: string | null
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
          target_competencies: string[] | null
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
          target_competencies?: string[] | null
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
          target_competencies?: string[] | null
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
      experiment_assignments: {
        Row: {
          assigned_at: string
          experiment_id: string
          id: string
          user_id: string
          variant: string
        }
        Insert: {
          assigned_at?: string
          experiment_id: string
          id?: string
          user_id: string
          variant: string
        }
        Update: {
          assigned_at?: string
          experiment_id?: string
          id?: string
          user_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_events: {
        Row: {
          created_at: string
          event_type: string
          experiment_id: string
          id: string
          metadata: Json | null
          user_id: string | null
          value: number | null
        }
        Insert: {
          created_at?: string
          event_type: string
          experiment_id: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
          value?: number | null
        }
        Update: {
          created_at?: string
          event_type?: string
          experiment_id?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "experiment_events_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          allocation: Json
          council_id: string
          created_at: string
          end_at: string | null
          hypothesis: string | null
          id: string
          kpi_name: string | null
          name: string
          result: Json | null
          start_at: string | null
          status: string
          stop_rules: Json | null
          type: string
          updated_at: string
          variants: Json
        }
        Insert: {
          allocation?: Json
          council_id: string
          created_at?: string
          end_at?: string | null
          hypothesis?: string | null
          id?: string
          kpi_name?: string | null
          name: string
          result?: Json | null
          start_at?: string | null
          status?: string
          stop_rules?: Json | null
          type: string
          updated_at?: string
          variants?: Json
        }
        Update: {
          allocation?: Json
          council_id?: string
          created_at?: string
          end_at?: string | null
          hypothesis?: string | null
          id?: string
          kpi_name?: string | null
          name?: string
          result?: Json | null
          start_at?: string | null
          status?: string
          stop_rules?: Json | null
          type?: string
          updated_at?: string
          variants?: Json
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          course_id: string
          created_at: string
          created_by: string
          error: string | null
          file_size_bytes: number | null
          formats: string[]
          id: string
          output_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by: string
          error?: string | null
          file_size_bytes?: number | null
          formats?: string[]
          id?: string
          output_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string
          error?: string | null
          file_size_bytes?: number | null
          formats?: string[]
          id?: string
          output_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      handbook_chapters: {
        Row: {
          chapter_key: string
          created_at: string | null
          curriculum_id: string | null
          description: string | null
          estimated_reading_minutes: number | null
          icon: string | null
          id: string
          is_premium: boolean | null
          is_published: boolean | null
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          chapter_key: string
          created_at?: string | null
          curriculum_id?: string | null
          description?: string | null
          estimated_reading_minutes?: number | null
          icon?: string | null
          id?: string
          is_premium?: boolean | null
          is_published?: boolean | null
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          chapter_key?: string
          created_at?: string | null
          curriculum_id?: string | null
          description?: string | null
          estimated_reading_minutes?: number | null
          icon?: string | null
          id?: string
          is_premium?: boolean | null
          is_published?: boolean | null
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handbook_chapters_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      handbook_exercise_responses: {
        Row: {
          exercise_id: string
          id: string
          responded_at: string | null
          response_text: string | null
          self_rating: number | null
          user_id: string
        }
        Insert: {
          exercise_id: string
          id?: string
          responded_at?: string | null
          response_text?: string | null
          self_rating?: number | null
          user_id: string
        }
        Update: {
          exercise_id?: string
          id?: string
          responded_at?: string | null
          response_text?: string | null
          self_rating?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "handbook_exercise_responses_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "handbook_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      handbook_exercises: {
        Row: {
          chapter_id: string
          created_at: string | null
          example_answer: string | null
          exercise_type: string
          explanation_text: string | null
          hint_text: string | null
          id: string
          is_active: boolean | null
          question_text: string
          section_id: string | null
          sort_order: number
        }
        Insert: {
          chapter_id: string
          created_at?: string | null
          example_answer?: string | null
          exercise_type: string
          explanation_text?: string | null
          hint_text?: string | null
          id?: string
          is_active?: boolean | null
          question_text: string
          section_id?: string | null
          sort_order?: number
        }
        Update: {
          chapter_id?: string
          created_at?: string | null
          example_answer?: string | null
          exercise_type?: string
          explanation_text?: string | null
          hint_text?: string | null
          id?: string
          is_active?: boolean | null
          question_text?: string
          section_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "handbook_exercises_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "handbook_chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handbook_exercises_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "handbook_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      handbook_progress: {
        Row: {
          chapter_id: string
          completed_at: string | null
          id: string
          last_section_id: string | null
          reading_time_minutes: number | null
          started_at: string | null
          user_id: string
        }
        Insert: {
          chapter_id: string
          completed_at?: string | null
          id?: string
          last_section_id?: string | null
          reading_time_minutes?: number | null
          started_at?: string | null
          user_id: string
        }
        Update: {
          chapter_id?: string
          completed_at?: string | null
          id?: string
          last_section_id?: string | null
          reading_time_minutes?: number | null
          started_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "handbook_progress_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "handbook_chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handbook_progress_last_section_id_fkey"
            columns: ["last_section_id"]
            isOneToOne: false
            referencedRelation: "handbook_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      handbook_recommendations: {
        Row: {
          chapter_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          priority: number | null
          recommendation_text: string
          trigger_condition: Json | null
          trigger_type: string
        }
        Insert: {
          chapter_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          priority?: number | null
          recommendation_text: string
          trigger_condition?: Json | null
          trigger_type: string
        }
        Update: {
          chapter_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          priority?: number | null
          recommendation_text?: string
          trigger_condition?: Json | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "handbook_recommendations_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "handbook_chapters"
            referencedColumns: ["id"]
          },
        ]
      }
      handbook_sections: {
        Row: {
          chapter_id: string
          content_markdown: string
          content_type: string | null
          created_at: string | null
          id: string
          section_key: string
          sort_order: number
          title: string
        }
        Insert: {
          chapter_id: string
          content_markdown: string
          content_type?: string | null
          created_at?: string | null
          id?: string
          section_key: string
          sort_order?: number
          title: string
        }
        Update: {
          chapter_id?: string
          content_markdown?: string
          content_type?: string | null
          created_at?: string | null
          id?: string
          section_key?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "handbook_sections_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "handbook_chapters"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          due_date: string | null
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          order_id: string
          pdf_url: string | null
          status: string
          stripe_invoice_id: string | null
          tax_rate: number
          total_gross_cents: number
          total_net_cents: number
          total_tax_cents: number
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          order_id: string
          pdf_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tax_rate?: number
          total_gross_cents?: number
          total_net_cents?: number
          total_tax_cents?: number
        }
        Update: {
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          order_id?: string
          pdf_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tax_rate?: number
          total_gross_cents?: number
          total_net_cents?: number
          total_tax_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
      learner_diagnostics: {
        Row: {
          completed_at: string | null
          created_at: string | null
          curriculum_id: string
          estimated_readiness_date: string | null
          exam_date: string | null
          focus_areas: string[] | null
          id: string
          recommended_path: string | null
          results: Json
          user_id: string
          weekly_time_minutes: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          curriculum_id: string
          estimated_readiness_date?: string | null
          exam_date?: string | null
          focus_areas?: string[] | null
          id?: string
          recommended_path?: string | null
          results?: Json
          user_id: string
          weekly_time_minutes?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          curriculum_id?: string
          estimated_readiness_date?: string | null
          exam_date?: string | null
          focus_areas?: string[] | null
          id?: string
          recommended_path?: string | null
          results?: Json
          user_id?: string
          weekly_time_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "learner_diagnostics_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_gates: {
        Row: {
          blocked_reason: string | null
          checked_at: string
          curriculum_id: string
          gate_status: string
          gate_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          blocked_reason?: string | null
          checked_at?: string
          curriculum_id: string
          gate_status?: string
          gate_type: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          blocked_reason?: string | null
          checked_at?: string
          curriculum_id?: string
          gate_status?: string
          gate_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_gates_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
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
      learner_profiles: {
        Row: {
          churn_risk_score: number | null
          confidence_score: number | null
          created_at: string
          exam_readiness_score: number | null
          frustration_threshold: string | null
          id: string
          last_activity_at: string | null
          learning_style: string | null
          motivation_type: string | null
          pace_category: string | null
          risk_areas: Json | null
          streak_best: number | null
          streak_current: number | null
          total_learning_minutes: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          churn_risk_score?: number | null
          confidence_score?: number | null
          created_at?: string
          exam_readiness_score?: number | null
          frustration_threshold?: string | null
          id?: string
          last_activity_at?: string | null
          learning_style?: string | null
          motivation_type?: string | null
          pace_category?: string | null
          risk_areas?: Json | null
          streak_best?: number | null
          streak_current?: number | null
          total_learning_minutes?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          churn_risk_score?: number | null
          confidence_score?: number | null
          created_at?: string
          exam_readiness_score?: number | null
          frustration_threshold?: string | null
          id?: string
          last_activity_at?: string | null
          learning_style?: string | null
          motivation_type?: string | null
          pace_category?: string | null
          risk_areas?: Json | null
          streak_best?: number | null
          streak_current?: number | null
          total_learning_minutes?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      learner_referrals: {
        Row: {
          context_course_id: string | null
          context_exam: string | null
          created_at: string
          id: string
          referral_code: string
          referred_email: string | null
          referred_user_id: string | null
          referrer_user_id: string
          reward_granted_at: string | null
          reward_type: string | null
          status: string | null
        }
        Insert: {
          context_course_id?: string | null
          context_exam?: string | null
          created_at?: string
          id?: string
          referral_code: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_user_id: string
          reward_granted_at?: string | null
          reward_type?: string | null
          status?: string | null
        }
        Update: {
          context_course_id?: string | null
          context_exam?: string | null
          created_at?: string
          id?: string
          referral_code?: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_user_id?: string
          reward_granted_at?: string | null
          reward_type?: string | null
          status?: string | null
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
            referencedRelation: "lesson_qc_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account: string
          amount_cents: number
          country: string | null
          created_at: string
          currency: string
          description: string | null
          event_time: string
          event_type: string
          id: string
          invoice_id: string | null
          order_id: string | null
          payment_id: string | null
          stripe_event_id: string | null
          tax_rate: number | null
        }
        Insert: {
          account: string
          amount_cents: number
          country?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          event_time?: string
          event_type: string
          id?: string
          invoice_id?: string | null
          order_id?: string | null
          payment_id?: string | null
          stripe_event_id?: string | null
          tax_rate?: number | null
        }
        Update: {
          account?: string
          amount_cents?: number
          country?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          event_time?: string
          event_type?: string
          id?: string
          invoice_id?: string | null
          order_id?: string | null
          payment_id?: string | null
          stripe_event_id?: string | null
          tax_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_improvement_suggestions: {
        Row: {
          applied: boolean
          applied_at: string | null
          created_at: string
          id: string
          lesson_id: string
          rule: string
          suggested_change: Json
        }
        Insert: {
          applied?: boolean
          applied_at?: string | null
          created_at?: string
          id?: string
          lesson_id: string
          rule: string
          suggested_change?: Json
        }
        Update: {
          applied?: boolean
          applied_at?: string | null
          created_at?: string
          id?: string
          lesson_id?: string
          rule?: string
          suggested_change?: Json
        }
        Relationships: []
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
            referencedRelation: "lesson_qc_view"
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
      lesson_quality_audits: {
        Row: {
          audit_score: number
          course_audit_id: string | null
          created_at: string
          dimension_scores: Json
          failed_rules: string[]
          id: string
          lesson_id: string
          verbesserungspotenzial: Json
        }
        Insert: {
          audit_score?: number
          course_audit_id?: string | null
          created_at?: string
          dimension_scores?: Json
          failed_rules?: string[]
          id?: string
          lesson_id: string
          verbesserungspotenzial?: Json
        }
        Update: {
          audit_score?: number
          course_audit_id?: string | null
          created_at?: string
          dimension_scores?: Json
          failed_rules?: string[]
          id?: string
          lesson_id?: string
          verbesserungspotenzial?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lesson_quality_audits_course_audit_id_fkey"
            columns: ["course_audit_id"]
            isOneToOne: false
            referencedRelation: "course_quality_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_revisions: {
        Row: {
          created_at: string
          id: string
          improvements_applied: string[]
          lesson_id: string
          new_content: Json | null
          old_content: Json | null
          reason: string
          score_after: number | null
          score_before: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          improvements_applied?: string[]
          lesson_id: string
          new_content?: Json | null
          old_content?: Json | null
          reason?: string
          score_after?: number | null
          score_before?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          improvements_applied?: string[]
          lesson_id?: string
          new_content?: Json | null
          old_content?: Json | null
          reason?: string
          score_after?: number | null
          score_before?: number | null
        }
        Relationships: []
      }
      lessons: {
        Row: {
          competency_id: string | null
          content: Json | null
          content_hash: string | null
          created_at: string
          duration_minutes: number | null
          exam_block: Json | null
          exam_relevance_score: number | null
          h5p_content_id: string | null
          id: string
          mastery_weight: number | null
          minicheck_parsed: boolean | null
          module_id: string
          qc_status: string | null
          quality_flags: Json | null
          quality_gate_status: string | null
          quarantine_reason: string | null
          quarantine_status: string | null
          quarantined_at: string | null
          sort_order: number | null
          status: string
          step: Database["public"]["Enums"]["lesson_step"]
          title: string
          weight_tag: string | null
        }
        Insert: {
          competency_id?: string | null
          content?: Json | null
          content_hash?: string | null
          created_at?: string
          duration_minutes?: number | null
          exam_block?: Json | null
          exam_relevance_score?: number | null
          h5p_content_id?: string | null
          id?: string
          mastery_weight?: number | null
          minicheck_parsed?: boolean | null
          module_id: string
          qc_status?: string | null
          quality_flags?: Json | null
          quality_gate_status?: string | null
          quarantine_reason?: string | null
          quarantine_status?: string | null
          quarantined_at?: string | null
          sort_order?: number | null
          status?: string
          step: Database["public"]["Enums"]["lesson_step"]
          title: string
          weight_tag?: string | null
        }
        Update: {
          competency_id?: string | null
          content?: Json | null
          content_hash?: string | null
          created_at?: string
          duration_minutes?: number | null
          exam_block?: Json | null
          exam_relevance_score?: number | null
          h5p_content_id?: string | null
          id?: string
          mastery_weight?: number | null
          minicheck_parsed?: boolean | null
          module_id?: string
          qc_status?: string | null
          quality_flags?: Json | null
          quality_gate_status?: string | null
          quarantine_reason?: string | null
          quarantine_status?: string | null
          quarantined_at?: string | null
          sort_order?: number | null
          status?: string
          step?: Database["public"]["Enums"]["lesson_step"]
          title?: string
          weight_tag?: string | null
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
      license_packages: {
        Row: {
          billing_address: Json | null
          billing_company: string | null
          billing_email: string | null
          billing_name: string | null
          billing_vat_id: string | null
          buyer_is_licensee: boolean
          buyer_user_id: string
          company_id: string | null
          created_at: string | null
          curriculum_id: string
          delivery_log: Json
          delivery_status: string
          expires_at: string
          id: string
          price_paid_cents: number
          product_id: string
          purchased_at: string | null
          quantity: number
          status: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_invoice_url: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          billing_address?: Json | null
          billing_company?: string | null
          billing_email?: string | null
          billing_name?: string | null
          billing_vat_id?: string | null
          buyer_is_licensee?: boolean
          buyer_user_id: string
          company_id?: string | null
          created_at?: string | null
          curriculum_id: string
          delivery_log?: Json
          delivery_status?: string
          expires_at: string
          id?: string
          price_paid_cents: number
          product_id: string
          purchased_at?: string | null
          quantity: number
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          billing_address?: Json | null
          billing_company?: string | null
          billing_email?: string | null
          billing_name?: string | null
          billing_vat_id?: string | null
          buyer_is_licensee?: boolean
          buyer_user_id?: string
          company_id?: string | null
          created_at?: string | null
          curriculum_id?: string
          delivery_log?: Json
          delivery_status?: string
          expires_at?: string
          id?: string
          price_paid_cents?: number
          product_id?: string
          purchased_at?: string | null
          quantity?: number
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "license_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "license_packages_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "license_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      license_seats: {
        Row: {
          assigned_at: string | null
          assigned_user_id: string | null
          claimed_by_ip: string | null
          claimed_user_agent: string | null
          created_at: string | null
          id: string
          invite_code: string | null
          invite_email: string | null
          invite_email_hash: string | null
          invite_expires_at: string | null
          licensee_first_name: string | null
          licensee_last_name: string | null
          licensee_personnel_number: string | null
          package_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_user_id?: string | null
          claimed_by_ip?: string | null
          claimed_user_agent?: string | null
          created_at?: string | null
          id?: string
          invite_code?: string | null
          invite_email?: string | null
          invite_email_hash?: string | null
          invite_expires_at?: string | null
          licensee_first_name?: string | null
          licensee_last_name?: string | null
          licensee_personnel_number?: string | null
          package_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_user_id?: string | null
          claimed_by_ip?: string | null
          claimed_user_agent?: string | null
          created_at?: string | null
          id?: string
          invite_code?: string | null
          invite_email?: string | null
          invite_email_hash?: string | null
          invite_expires_at?: string | null
          licensee_first_name?: string | null
          licensee_last_name?: string | null
          licensee_personnel_number?: string | null
          package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "license_seats_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "license_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      management_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          data: Json | null
          description: string | null
          id: string
          resolved_at: string | null
          severity: string
          source: string | null
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          data?: Json | null
          description?: string | null
          id?: string
          resolved_at?: string | null
          severity?: string
          source?: string | null
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          data?: Json | null
          description?: string | null
          id?: string
          resolved_at?: string | null
          severity?: string
          source?: string | null
          title?: string
        }
        Relationships: []
      }
      marketing_assets: {
        Row: {
          asset_type: string
          campaign_id: string | null
          content: string
          created_at: string
          id: string
          legal_check_passed: boolean | null
          llm_used: string
          seo_score: number | null
          status: string
          target_group: string
          template_used: string | null
          title: string
          updated_at: string
          validation_report: Json | null
          validation_score: number | null
        }
        Insert: {
          asset_type: string
          campaign_id?: string | null
          content: string
          created_at?: string
          id?: string
          legal_check_passed?: boolean | null
          llm_used?: string
          seo_score?: number | null
          status?: string
          target_group: string
          template_used?: string | null
          title: string
          updated_at?: string
          validation_report?: Json | null
          validation_score?: number | null
        }
        Update: {
          asset_type?: string
          campaign_id?: string | null
          content?: string
          created_at?: string
          id?: string
          legal_check_passed?: boolean | null
          llm_used?: string
          seo_score?: number | null
          status?: string
          target_group?: string
          template_used?: string | null
          title?: string
          updated_at?: string
          validation_report?: Json | null
          validation_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_budget_requests: {
        Row: {
          campaign_name: string
          created_at: string
          current_budget: number
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          expected_roi: number | null
          id: string
          justification: Json
          plan_id: string | null
          proof: Json
          requested_amount: number
          risk_level: string
          status: string
        }
        Insert: {
          campaign_name: string
          created_at?: string
          current_budget: number
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          expected_roi?: number | null
          id?: string
          justification?: Json
          plan_id?: string | null
          proof?: Json
          requested_amount: number
          risk_level?: string
          status?: string
        }
        Update: {
          campaign_name?: string
          created_at?: string
          current_budget?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          expected_roi?: number | null
          id?: string
          justification?: Json
          plan_id?: string | null
          proof?: Json
          requested_amount?: number
          risk_level?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_budget_requests_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "marketing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          budget_allocated: number
          budget_spent: number
          channel: string
          created_at: string
          hypothesis: string | null
          id: string
          kill_switch_rules: Json
          kpis: Json
          metrics: Json
          name: string
          plan_id: string | null
          started_at: string | null
          status: string
          stop_reason: string | null
          stopped_at: string | null
          target_groups: string[]
          updated_at: string
          validation_report: Json | null
          validation_status: string | null
        }
        Insert: {
          budget_allocated?: number
          budget_spent?: number
          channel: string
          created_at?: string
          hypothesis?: string | null
          id?: string
          kill_switch_rules?: Json
          kpis?: Json
          metrics?: Json
          name: string
          plan_id?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          stopped_at?: string | null
          target_groups?: string[]
          updated_at?: string
          validation_report?: Json | null
          validation_status?: string | null
        }
        Update: {
          budget_allocated?: number
          budget_spent?: number
          channel?: string
          created_at?: string
          hypothesis?: string | null
          id?: string
          kill_switch_rules?: Json
          kpis?: Json
          metrics?: Json
          name?: string
          plan_id?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          stopped_at?: string | null
          target_groups?: string[]
          updated_at?: string
          validation_report?: Json | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "marketing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_experiments: {
        Row: {
          campaign_id: string | null
          completed_at: string | null
          confidence_level: number | null
          created_at: string
          current_sample_size: number
          hypothesis: string
          id: string
          learnings: string | null
          metrics: Json
          name: string
          sample_size_target: number
          started_at: string | null
          status: string
          variant_a: Json
          variant_b: Json
          winner: string | null
        }
        Insert: {
          campaign_id?: string | null
          completed_at?: string | null
          confidence_level?: number | null
          created_at?: string
          current_sample_size?: number
          hypothesis: string
          id?: string
          learnings?: string | null
          metrics?: Json
          name: string
          sample_size_target?: number
          started_at?: string | null
          status?: string
          variant_a: Json
          variant_b: Json
          winner?: string | null
        }
        Update: {
          campaign_id?: string | null
          completed_at?: string | null
          confidence_level?: number | null
          created_at?: string
          current_sample_size?: number
          hypothesis?: string
          id?: string
          learnings?: string | null
          metrics?: Json
          name?: string
          sample_size_target?: number
          started_at?: string | null
          status?: string
          variant_a?: Json
          variant_b?: Json
          winner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_experiments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_learnings: {
        Row: {
          action_taken: string | null
          created_at: string
          id: string
          impact_area: string
          learning: string
          source_id: string | null
          source_type: string
        }
        Insert: {
          action_taken?: string | null
          created_at?: string
          id?: string
          impact_area: string
          learning: string
          source_id?: string | null
          source_type: string
        }
        Update: {
          action_taken?: string | null
          created_at?: string
          id?: string
          impact_area?: string
          learning?: string
          source_id?: string | null
          source_type?: string
        }
        Relationships: []
      }
      marketing_plans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          budget_split: Json
          budget_total: number
          created_at: string
          hypotheses: Json
          id: string
          llm_used: string
          month: string
          priorities: string[]
          status: string
          strategy_json: Json
          updated_at: string
          validated_at: string | null
          validation_report: Json | null
          validation_score: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          budget_split?: Json
          budget_total?: number
          created_at?: string
          hypotheses?: Json
          id?: string
          llm_used?: string
          month: string
          priorities?: string[]
          status?: string
          strategy_json?: Json
          updated_at?: string
          validated_at?: string | null
          validation_report?: Json | null
          validation_score?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          budget_split?: Json
          budget_total?: number
          created_at?: string
          hypotheses?: Json
          id?: string
          llm_used?: string
          month?: string
          priorities?: string[]
          status?: string
          strategy_json?: Json
          updated_at?: string
          validated_at?: string | null
          validation_report?: Json | null
          validation_score?: number | null
        }
        Relationships: []
      }
      minicheck_questions: {
        Row: {
          competency_id: string | null
          correct_answer: number
          created_at: string
          difficulty: string | null
          explanation: string | null
          id: string
          lesson_id: string
          options: Json
          question_text: string
          sort_order: number | null
        }
        Insert: {
          competency_id?: string | null
          correct_answer: number
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          id?: string
          lesson_id: string
          options: Json
          question_text: string
          sort_order?: number | null
        }
        Update: {
          competency_id?: string | null
          correct_answer?: number
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          id?: string
          lesson_id?: string
          options?: Json
          question_text?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "minicheck_questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_qc_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minicheck_questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
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
          learning_field_code: string | null
          learning_field_id: string | null
          sort_order: number | null
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          learning_field_code?: string | null
          learning_field_id?: string | null
          sort_order?: number | null
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          learning_field_code?: string | null
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
      oral_exam_questions: {
        Row: {
          ai_feedback: string | null
          answer_started_at: string | null
          answer_submitted_at: string | null
          begriffssicherheit_score: number | null
          blueprint_id: string | null
          competency_id: string | null
          covered_points: string[] | null
          created_at: string
          expected_answer_points: string[] | null
          fachlichkeit_score: number | null
          follow_up_questions: string[] | null
          id: string
          learning_field_id: string | null
          missed_points: string[] | null
          order_index: number
          praxisbezug_score: number | null
          question_text: string
          session_id: string
          struktur_score: number | null
          time_limit_seconds: number | null
          time_spent_seconds: number | null
          user_answer: string | null
        }
        Insert: {
          ai_feedback?: string | null
          answer_started_at?: string | null
          answer_submitted_at?: string | null
          begriffssicherheit_score?: number | null
          blueprint_id?: string | null
          competency_id?: string | null
          covered_points?: string[] | null
          created_at?: string
          expected_answer_points?: string[] | null
          fachlichkeit_score?: number | null
          follow_up_questions?: string[] | null
          id?: string
          learning_field_id?: string | null
          missed_points?: string[] | null
          order_index: number
          praxisbezug_score?: number | null
          question_text: string
          session_id: string
          struktur_score?: number | null
          time_limit_seconds?: number | null
          time_spent_seconds?: number | null
          user_answer?: string | null
        }
        Update: {
          ai_feedback?: string | null
          answer_started_at?: string | null
          answer_submitted_at?: string | null
          begriffssicherheit_score?: number | null
          blueprint_id?: string | null
          competency_id?: string | null
          covered_points?: string[] | null
          created_at?: string
          expected_answer_points?: string[] | null
          fachlichkeit_score?: number | null
          follow_up_questions?: string[] | null
          id?: string
          learning_field_id?: string | null
          missed_points?: string[] | null
          order_index?: number
          praxisbezug_score?: number | null
          question_text?: string
          session_id?: string
          struktur_score?: number | null
          time_limit_seconds?: number | null
          time_spent_seconds?: number | null
          user_answer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oral_exam_questions_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "oral_exam_questions_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oral_exam_questions_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oral_exam_questions_learning_field_id_fkey"
            columns: ["learning_field_id"]
            isOneToOne: false
            referencedRelation: "learning_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oral_exam_questions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "oral_exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      oral_exam_sessions: {
        Row: {
          begriffssicherheit_score: number | null
          blueprint_id: string | null
          created_at: string
          current_question_index: number
          curriculum_id: string
          fachlichkeit_score: number | null
          finished_at: string | null
          id: string
          improvement_suggestions: string[] | null
          mode: string
          overall_score: number | null
          passed: boolean | null
          praxisbezug_score: number | null
          started_at: string
          strengths: string[] | null
          struktur_score: number | null
          time_limit_minutes: number | null
          total_questions: number
          updated_at: string
          user_id: string
          weaknesses: string[] | null
        }
        Insert: {
          begriffssicherheit_score?: number | null
          blueprint_id?: string | null
          created_at?: string
          current_question_index?: number
          curriculum_id: string
          fachlichkeit_score?: number | null
          finished_at?: string | null
          id?: string
          improvement_suggestions?: string[] | null
          mode?: string
          overall_score?: number | null
          passed?: boolean | null
          praxisbezug_score?: number | null
          started_at?: string
          strengths?: string[] | null
          struktur_score?: number | null
          time_limit_minutes?: number | null
          total_questions?: number
          updated_at?: string
          user_id: string
          weaknesses?: string[] | null
        }
        Update: {
          begriffssicherheit_score?: number | null
          blueprint_id?: string | null
          created_at?: string
          current_question_index?: number
          curriculum_id?: string
          fachlichkeit_score?: number | null
          finished_at?: string | null
          id?: string
          improvement_suggestions?: string[] | null
          mode?: string
          overall_score?: number | null
          passed?: boolean | null
          praxisbezug_score?: number | null
          started_at?: string
          strengths?: string[] | null
          struktur_score?: number | null
          time_limit_minutes?: number | null
          total_questions?: number
          updated_at?: string
          user_id?: string
          weaknesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "oral_exam_sessions_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "exam_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oral_exam_sessions_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          description: string
          id: string
          order_id: string
          product_id: string | null
          quantity: number
          tax_amount_cents: number
          tax_rate: number
          unit_amount_gross_cents: number
          unit_amount_net_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          order_id: string
          product_id?: string | null
          quantity?: number
          tax_amount_cents?: number
          tax_rate?: number
          unit_amount_gross_cents?: number
          unit_amount_net_cents?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
          tax_amount_cents?: number
          tax_rate?: number
          unit_amount_gross_cents?: number
          unit_amount_net_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_address: Json | null
          billing_company: string | null
          billing_email: string | null
          billing_name: string | null
          billing_vat_id: string | null
          buyer_user_id: string
          country: string | null
          created_at: string
          currency: string
          id: string
          license_package_id: string | null
          notes: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          tax_cents: number
          tax_mode: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          billing_address?: Json | null
          billing_company?: string | null
          billing_email?: string | null
          billing_name?: string | null
          billing_vat_id?: string | null
          buyer_user_id: string
          country?: string | null
          created_at?: string
          currency?: string
          id?: string
          license_package_id?: string | null
          notes?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          tax_mode?: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          billing_address?: Json | null
          billing_company?: string | null
          billing_email?: string | null
          billing_name?: string | null
          billing_vat_id?: string | null
          buyer_user_id?: string
          country?: string | null
          created_at?: string
          currency?: string
          id?: string
          license_package_id?: string | null
          notes?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          tax_mode?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_license_package_id_fkey"
            columns: ["license_package_id"]
            isOneToOne: false
            referencedRelation: "license_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      patch_proposals: {
        Row: {
          after: Json
          applied_at: string | null
          apply_error: string | null
          approved_at: string | null
          approved_by: string | null
          before: Json
          council_id: string
          created_at: string
          dedupe_key: string | null
          diff_summary: string | null
          entity_id: string
          entity_type: string
          id: string
          patch_type: string
          risk: string
          status: string
          updated_at: string
          validated_at: string | null
          validator_result: Json | null
        }
        Insert: {
          after: Json
          applied_at?: string | null
          apply_error?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before: Json
          council_id: string
          created_at?: string
          dedupe_key?: string | null
          diff_summary?: string | null
          entity_id: string
          entity_type: string
          id?: string
          patch_type?: string
          risk?: string
          status?: string
          updated_at?: string
          validated_at?: string | null
          validator_result?: Json | null
        }
        Update: {
          after?: Json
          applied_at?: string | null
          apply_error?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before?: Json
          council_id?: string
          created_at?: string
          dedupe_key?: string | null
          diff_summary?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          patch_type?: string
          risk?: string
          status?: string
          updated_at?: string
          validated_at?: string | null
          validator_result?: Json | null
        }
        Relationships: []
      }
      patch_revisions: {
        Row: {
          after: Json
          applied_at: string
          applied_by: string | null
          before: Json
          entity_id: string
          entity_type: string
          id: string
          patch_id: string
          rollback_of: string | null
        }
        Insert: {
          after: Json
          applied_at?: string
          applied_by?: string | null
          before: Json
          entity_id: string
          entity_type: string
          id?: string
          patch_id: string
          rollback_of?: string | null
        }
        Update: {
          after?: Json
          applied_at?: string
          applied_by?: string | null
          before?: Json
          entity_id?: string
          entity_type?: string
          id?: string
          patch_id?: string
          rollback_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patch_revisions_patch_id_fkey"
            columns: ["patch_id"]
            isOneToOne: false
            referencedRelation: "patch_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          fee_cents: number
          id: string
          net_cents: number
          order_id: string
          paid_at: string | null
          payment_status: string
          stripe_charge_id: string | null
          stripe_event_id: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          fee_cents?: number
          id?: string
          net_cents?: number
          order_id: string
          paid_at?: string | null
          payment_status?: string
          stripe_charge_id?: string | null
          stripe_event_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          fee_cents?: number
          id?: string
          net_cents?: number
          order_id?: string
          paid_at?: string | null
          payment_status?: string
          stripe_charge_id?: string | null
          stripe_event_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_metrics: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          metric_date: string
          metric_name: string
          metric_type: string
          metric_value: number
          threshold_critical: number | null
          threshold_warning: number | null
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          metric_date?: string
          metric_name: string
          metric_type: string
          metric_value: number
          threshold_critical?: number | null
          threshold_warning?: number | null
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          metric_date?: string
          metric_name?: string
          metric_type?: string
          metric_value?: number
          threshold_critical?: number | null
          threshold_warning?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      post_validation_results: {
        Row: {
          auto_fixed: number
          completed_at: string | null
          course_id: string
          created_at: string
          findings: Json | null
          id: string
          manual_review: number
          status: string
          validation_type: string
        }
        Insert: {
          auto_fixed?: number
          completed_at?: string | null
          course_id: string
          created_at?: string
          findings?: Json | null
          id?: string
          manual_review?: number
          status?: string
          validation_type: string
        }
        Update: {
          auto_fixed?: number
          completed_at?: string | null
          course_id?: string
          created_at?: string
          findings?: Json | null
          id?: string
          manual_review?: number
          status?: string
          validation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_validation_results_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
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
      product_price_tiers: {
        Row: {
          created_at: string | null
          id: string
          max_quantity: number | null
          min_quantity: number
          price_cents: number
          product_id: string
          stripe_price_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_quantity?: number | null
          min_quantity: number
          price_cents: number
          product_id: string
          stripe_price_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          price_cents?: number
          product_id?: string
          stripe_price_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_price_tiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          full_name: string | null
          id: string
          login_username: string | null
          managed_account: boolean | null
          personnel_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          login_username?: string | null
          managed_account?: boolean | null
          personnel_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          login_username?: string | null
          managed_account?: boolean | null
          personnel_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_narratives: {
        Row: {
          content: string
          created_at: string
          icon: string | null
          id: string
          metrics: Json | null
          narrative_type: string
          seen_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          icon?: string | null
          id?: string
          metrics?: Json | null
          narrative_type: string
          seen_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          icon?: string | null
          id?: string
          metrics?: Json | null
          narrative_type?: string
          seen_at?: string | null
          title?: string
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
      qc_run_results: {
        Row: {
          completed_at: string | null
          course_id: string
          created_at: string
          fixes_applied: Json | null
          id: string
          issues: Json | null
          run_type: string
          started_at: string
          stats: Json | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          created_at?: string
          fixes_applied?: Json | null
          id?: string
          issues?: Json | null
          run_type: string
          started_at?: string
          stats?: Json | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          created_at?: string
          fixes_applied?: Json | null
          id?: string
          issues?: Json | null
          run_type?: string
          started_at?: string
          stats?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_run_results_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      qm_documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          content: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          document_type: string
          effective_from: string | null
          effective_until: string | null
          id: string
          next_review_date: string | null
          review_interval_months: number | null
          status: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          content?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_type: string
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          next_review_date?: string | null
          review_interval_months?: number | null
          status?: string
          title: string
          updated_at?: string
          version?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          content?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_type?: string
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          next_review_date?: string | null
          review_interval_months?: number | null
          status?: string
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      quality_checks: {
        Row: {
          check_type: string
          created_at: string
          curriculum_product_id: string
          details: Json | null
          executed_at: string | null
          executed_by: string | null
          id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          check_type: string
          created_at?: string
          curriculum_product_id: string
          details?: Json | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          check_type?: string
          created_at?: string
          curriculum_product_id?: string
          details?: Json | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_checks_curriculum_product_id_fkey"
            columns: ["curriculum_product_id"]
            isOneToOne: false
            referencedRelation: "curriculum_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_checks_curriculum_product_id_fkey"
            columns: ["curriculum_product_id"]
            isOneToOne: false
            referencedRelation: "curriculum_products_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_gate_results: {
        Row: {
          checked_at: string
          course_id: string
          gate_name: string
          gate_number: number
          id: string
          issues: Json | null
          metadata: Json | null
          score: number | null
          status: string
        }
        Insert: {
          checked_at?: string
          course_id: string
          gate_name: string
          gate_number: number
          id?: string
          issues?: Json | null
          metadata?: Json | null
          score?: number | null
          status?: string
        }
        Update: {
          checked_at?: string
          course_id?: string
          gate_name?: string
          gate_number?: number
          id?: string
          issues?: Json | null
          metadata?: Json | null
          score?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_gate_results_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      question_attempts: {
        Row: {
          answered_at: string
          created_at: string
          id: string
          is_correct: boolean
          question_id: string
          selected_answer: number
          session_id: string | null
          user_id: string
        }
        Insert: {
          answered_at?: string
          created_at?: string
          id?: string
          is_correct: boolean
          question_id: string
          selected_answer: number
          session_id?: string | null
          user_id: string
        }
        Update: {
          answered_at?: string
          created_at?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          selected_answer?: number
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      question_blueprints: {
        Row: {
          allowed_question_types: string[]
          approved_at: string | null
          approved_by: string | null
          canonical_statement: string
          change_reason: string | null
          cognitive_level: Database["public"]["Enums"]["cognitive_level"]
          competency_id: string | null
          created_at: string
          created_by: string | null
          curriculum_id: string
          deprecated_at: string | null
          didactic_intent: Database["public"]["Enums"]["didactic_intent"]
          exam_relevance: Database["public"]["Enums"]["exam_relevance"]
          explanation_template: string | null
          id: string
          knowledge_type: Database["public"]["Enums"]["knowledge_type"]
          language_level: string | null
          learning_field_id: string | null
          max_similarity_score: number | null
          max_variations: number | null
          min_variation_distance: number | null
          name: string
          question_template: string
          real_world_context: boolean
          status: Database["public"]["Enums"]["blueprint_status"]
          typical_exam_trap: string | null
          updated_at: string
          variation_modes:
            | Database["public"]["Enums"]["variation_mode"][]
            | null
          version: string
        }
        Insert: {
          allowed_question_types?: string[]
          approved_at?: string | null
          approved_by?: string | null
          canonical_statement: string
          change_reason?: string | null
          cognitive_level?: Database["public"]["Enums"]["cognitive_level"]
          competency_id?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_id: string
          deprecated_at?: string | null
          didactic_intent?: Database["public"]["Enums"]["didactic_intent"]
          exam_relevance?: Database["public"]["Enums"]["exam_relevance"]
          explanation_template?: string | null
          id?: string
          knowledge_type?: Database["public"]["Enums"]["knowledge_type"]
          language_level?: string | null
          learning_field_id?: string | null
          max_similarity_score?: number | null
          max_variations?: number | null
          min_variation_distance?: number | null
          name: string
          question_template: string
          real_world_context?: boolean
          status?: Database["public"]["Enums"]["blueprint_status"]
          typical_exam_trap?: string | null
          updated_at?: string
          variation_modes?:
            | Database["public"]["Enums"]["variation_mode"][]
            | null
          version?: string
        }
        Update: {
          allowed_question_types?: string[]
          approved_at?: string | null
          approved_by?: string | null
          canonical_statement?: string
          change_reason?: string | null
          cognitive_level?: Database["public"]["Enums"]["cognitive_level"]
          competency_id?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_id?: string
          deprecated_at?: string | null
          didactic_intent?: Database["public"]["Enums"]["didactic_intent"]
          exam_relevance?: Database["public"]["Enums"]["exam_relevance"]
          explanation_template?: string | null
          id?: string
          knowledge_type?: Database["public"]["Enums"]["knowledge_type"]
          language_level?: string | null
          learning_field_id?: string | null
          max_similarity_score?: number | null
          max_variations?: number | null
          min_variation_distance?: number | null
          name?: string
          question_template?: string
          real_world_context?: boolean
          status?: Database["public"]["Enums"]["blueprint_status"]
          typical_exam_trap?: string | null
          updated_at?: string
          variation_modes?:
            | Database["public"]["Enums"]["variation_mode"][]
            | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_blueprints_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_blueprints_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_blueprints_learning_field_id_fkey"
            columns: ["learning_field_id"]
            isOneToOne: false
            referencedRelation: "learning_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      readiness_scores: {
        Row: {
          calculated_at: string | null
          created_at: string | null
          curriculum_id: string
          days_until_ready: number | null
          id: string
          overall_readiness: number | null
          predicted_exam_score: number | null
          strong_areas: Json | null
          trend: string | null
          user_id: string
          weak_areas: Json | null
        }
        Insert: {
          calculated_at?: string | null
          created_at?: string | null
          curriculum_id: string
          days_until_ready?: number | null
          id?: string
          overall_readiness?: number | null
          predicted_exam_score?: number | null
          strong_areas?: Json | null
          trend?: string | null
          user_id: string
          weak_areas?: Json | null
        }
        Update: {
          calculated_at?: string | null
          created_at?: string | null
          curriculum_id?: string
          days_until_ready?: number | null
          id?: string
          overall_readiness?: number | null
          predicted_exam_score?: number | null
          strong_areas?: Json | null
          trend?: string | null
          user_id?: string
          weak_areas?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "readiness_scores_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
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
      retention_events: {
        Row: {
          channel: string | null
          clicked_at: string | null
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          payload: Json | null
          status: string | null
          trigger_reason: string | null
          user_id: string
        }
        Insert: {
          channel?: string | null
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          status?: string | null
          trigger_reason?: string | null
          user_id: string
        }
        Update: {
          channel?: string | null
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          status?: string | null
          trigger_reason?: string | null
          user_id?: string
        }
        Relationships: []
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
      risk_scores: {
        Row: {
          computed_at: string
          evidence: Json
          id: string
          risk_type: string
          scope: string
          scope_id: string
          score: number
          severity: string
        }
        Insert: {
          computed_at?: string
          evidence?: Json
          id?: string
          risk_type: string
          scope: string
          scope_id: string
          score?: number
          severity?: string
        }
        Update: {
          computed_at?: string
          evidence?: Json
          id?: string
          risk_type?: string
          scope?: string
          scope_id?: string
          score?: number
          severity?: string
        }
        Relationships: []
      }
      seo_documents: {
        Row: {
          beruf_id: string | null
          canonical_url: string | null
          competency_id: string | null
          content_hash: string | null
          content_md: string | null
          created_at: string
          curriculum_id: string | null
          doc_type: string
          excerpt: string | null
          id: string
          internal_links: Json | null
          language: string
          meta_description: string | null
          meta_title: string | null
          og_image_path: string | null
          product_key: string | null
          published_at: string | null
          qc_report: Json | null
          qc_score: number | null
          similarity_group: string | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          beruf_id?: string | null
          canonical_url?: string | null
          competency_id?: string | null
          content_hash?: string | null
          content_md?: string | null
          created_at?: string
          curriculum_id?: string | null
          doc_type: string
          excerpt?: string | null
          id?: string
          internal_links?: Json | null
          language?: string
          meta_description?: string | null
          meta_title?: string | null
          og_image_path?: string | null
          product_key?: string | null
          published_at?: string | null
          qc_report?: Json | null
          qc_score?: number | null
          similarity_group?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          beruf_id?: string | null
          canonical_url?: string | null
          competency_id?: string | null
          content_hash?: string | null
          content_md?: string | null
          created_at?: string
          curriculum_id?: string | null
          doc_type?: string
          excerpt?: string | null
          id?: string
          internal_links?: Json | null
          language?: string
          meta_description?: string | null
          meta_title?: string | null
          og_image_path?: string | null
          product_key?: string | null
          published_at?: string | null
          qc_report?: Json | null
          qc_score?: number | null
          similarity_group?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_documents_beruf_id_fkey"
            columns: ["beruf_id"]
            isOneToOne: false
            referencedRelation: "berufe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_documents_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_documents_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_generation_jobs: {
        Row: {
          completed_at: string | null
          cost_eur: number | null
          created_at: string
          error: string | null
          id: string
          job_type: string
          logs: Json | null
          model: string | null
          result_doc_id: string | null
          started_at: string | null
          status: string
          target_ref: Json
          template_key: string | null
          tokens_used: number | null
        }
        Insert: {
          completed_at?: string | null
          cost_eur?: number | null
          created_at?: string
          error?: string | null
          id?: string
          job_type: string
          logs?: Json | null
          model?: string | null
          result_doc_id?: string | null
          started_at?: string | null
          status?: string
          target_ref?: Json
          template_key?: string | null
          tokens_used?: number | null
        }
        Update: {
          completed_at?: string | null
          cost_eur?: number | null
          created_at?: string
          error?: string | null
          id?: string
          job_type?: string
          logs?: Json | null
          model?: string | null
          result_doc_id?: string | null
          started_at?: string | null
          status?: string
          target_ref?: Json
          template_key?: string | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_generation_jobs_result_doc_id_fkey"
            columns: ["result_doc_id"]
            isOneToOne: false
            referencedRelation: "seo_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_generation_jobs_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "seo_templates"
            referencedColumns: ["template_key"]
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
      seo_templates: {
        Row: {
          created_at: string
          display_name: string
          doc_type: string
          id: string
          is_active: boolean
          outline_json: Json
          prompt_system: string | null
          prompt_user: string | null
          qc_rules_json: Json | null
          style_rules_json: Json | null
          template_key: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          display_name: string
          doc_type: string
          id?: string
          is_active?: boolean
          outline_json?: Json
          prompt_system?: string | null
          prompt_user?: string | null
          qc_rules_json?: Json | null
          style_rules_json?: Json | null
          template_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          display_name?: string
          doc_type?: string
          id?: string
          is_active?: boolean
          outline_json?: Json
          prompt_system?: string | null
          prompt_user?: string | null
          qc_rules_json?: Json | null
          style_rules_json?: Json | null
          template_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      spaced_repetition_cards: {
        Row: {
          bloom_level: string
          bloom_modifier: number
          blueprint_id: string | null
          competency_id: string | null
          created_at: string
          curriculum_id: string
          ease_factor: number
          id: string
          interval_days: number
          is_graduated: boolean
          is_new: boolean
          is_suspended: boolean
          lapses: number
          last_reviewed_at: string | null
          next_review_at: string
          question_id: string | null
          repetition_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bloom_level?: string
          bloom_modifier?: number
          blueprint_id?: string | null
          competency_id?: string | null
          created_at?: string
          curriculum_id: string
          ease_factor?: number
          id?: string
          interval_days?: number
          is_graduated?: boolean
          is_new?: boolean
          is_suspended?: boolean
          lapses?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          question_id?: string | null
          repetition_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bloom_level?: string
          bloom_modifier?: number
          blueprint_id?: string | null
          competency_id?: string | null
          created_at?: string
          curriculum_id?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          is_graduated?: boolean
          is_new?: boolean
          is_suspended?: boolean
          lapses?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          question_id?: string | null
          repetition_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spaced_repetition_cards_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprint_questions_view"
            referencedColumns: ["blueprint_id"]
          },
          {
            foreignKeyName: "spaced_repetition_cards_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "question_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spaced_repetition_cards_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spaced_repetition_cards_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spaced_repetition_cards_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spaced_repetition_cards_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      spaced_repetition_reviews: {
        Row: {
          bloom_level: string
          card_id: string
          id: string
          new_ease_factor: number
          new_interval: number
          previous_ease_factor: number
          previous_interval: number
          quality_rating: number
          response_time_ms: number | null
          reviewed_at: string
          user_id: string
        }
        Insert: {
          bloom_level: string
          card_id: string
          id?: string
          new_ease_factor: number
          new_interval: number
          previous_ease_factor: number
          previous_interval: number
          quality_rating: number
          response_time_ms?: number | null
          reviewed_at?: string
          user_id: string
        }
        Update: {
          bloom_level?: string
          card_id?: string
          id?: string
          new_ease_factor?: number
          new_interval?: number
          previous_ease_factor?: number
          previous_interval?: number
          quality_rating?: number
          response_time_ms?: number | null
          reviewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spaced_repetition_reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "spaced_repetition_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      spaced_repetition_sessions: {
        Row: {
          correct_count: number
          created_at: string
          curriculum_id: string
          duration_seconds: number | null
          finished_at: string | null
          id: string
          incorrect_count: number
          new_cards: number
          review_cards: number
          started_at: string
          streak_continued: boolean | null
          total_cards: number
          user_id: string
        }
        Insert: {
          correct_count?: number
          created_at?: string
          curriculum_id: string
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          incorrect_count?: number
          new_cards?: number
          review_cards?: number
          started_at?: string
          streak_continued?: boolean | null
          total_cards?: number
          user_id: string
        }
        Update: {
          correct_count?: number
          created_at?: string
          curriculum_id?: string
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          incorrect_count?: number
          new_cards?: number
          review_cards?: number
          started_at?: string
          streak_continued?: boolean | null
          total_cards?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spaced_repetition_sessions_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          access_duration_days: number | null
          created_at: string | null
          description: string | null
          id: string
          includes_ai_tutor: boolean | null
          includes_exam_trainer: boolean | null
          includes_handbook: boolean | null
          includes_learning_course: boolean | null
          includes_oral_trainer: boolean | null
          is_active: boolean | null
          name: string
          product_key: string
          sort_order: number | null
          stripe_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_duration_days?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          includes_ai_tutor?: boolean | null
          includes_exam_trainer?: boolean | null
          includes_handbook?: boolean | null
          includes_learning_course?: boolean | null
          includes_oral_trainer?: boolean | null
          is_active?: boolean | null
          name: string
          product_key: string
          sort_order?: number | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_duration_days?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          includes_ai_tutor?: boolean | null
          includes_exam_trainer?: boolean | null
          includes_handbook?: boolean | null
          includes_learning_course?: boolean | null
          includes_oral_trainer?: boolean | null
          is_active?: boolean | null
          name?: string
          product_key?: string
          sort_order?: number | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      support_ai_responses: {
        Row: {
          answer: string
          answer_type: string
          context_competency_id: string | null
          context_course_id: string | null
          context_lesson_id: string | null
          created_at: string
          feedback_text: string | null
          guardrail_flags: Json | null
          id: string
          model_used: string
          question: string
          ticket_id: string | null
          tokens_used: number | null
          user_id: string
          was_helpful: boolean | null
        }
        Insert: {
          answer: string
          answer_type?: string
          context_competency_id?: string | null
          context_course_id?: string | null
          context_lesson_id?: string | null
          created_at?: string
          feedback_text?: string | null
          guardrail_flags?: Json | null
          id?: string
          model_used?: string
          question: string
          ticket_id?: string | null
          tokens_used?: number | null
          user_id: string
          was_helpful?: boolean | null
        }
        Update: {
          answer?: string
          answer_type?: string
          context_competency_id?: string | null
          context_course_id?: string | null
          context_lesson_id?: string | null
          created_at?: string
          feedback_text?: string | null
          guardrail_flags?: Json | null
          id?: string
          model_used?: string
          question?: string
          ticket_id?: string | null
          tokens_used?: number | null
          user_id?: string
          was_helpful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ai_responses_context_competency_id_fkey"
            columns: ["context_competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ai_responses_context_course_id_fkey"
            columns: ["context_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ai_responses_context_lesson_id_fkey"
            columns: ["context_lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_qc_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ai_responses_context_lesson_id_fkey"
            columns: ["context_lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ai_responses_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_faq: {
        Row: {
          answer: string
          auto_generated: boolean | null
          competency_id: string | null
          course_id: string | null
          created_at: string | null
          helpful_count: number | null
          id: string
          is_published: boolean | null
          learning_phase: string | null
          question: string
          source_ticket_id: string | null
          target_audience: string | null
          ticket_type: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          answer: string
          auto_generated?: boolean | null
          competency_id?: string | null
          course_id?: string | null
          created_at?: string | null
          helpful_count?: number | null
          id?: string
          is_published?: boolean | null
          learning_phase?: string | null
          question: string
          source_ticket_id?: string | null
          target_audience?: string | null
          ticket_type?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          answer?: string
          auto_generated?: boolean | null
          competency_id?: string | null
          course_id?: string | null
          created_at?: string | null
          helpful_count?: number | null
          id?: string
          is_published?: boolean | null
          learning_phase?: string | null
          question?: string
          source_ticket_id?: string | null
          target_audience?: string | null
          ticket_type?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "support_faq_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_faq_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_faq_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_feedback_loop: {
        Row: {
          affected_competency_id: string | null
          affected_course_id: string | null
          affected_lesson_id: string | null
          auto_detected: boolean
          classification: string
          created_at: string
          id: string
          improvement_status: string
          improvement_type: string | null
          notes: string | null
          processed_at: string | null
          ticket_id: string
        }
        Insert: {
          affected_competency_id?: string | null
          affected_course_id?: string | null
          affected_lesson_id?: string | null
          auto_detected?: boolean
          classification: string
          created_at?: string
          id?: string
          improvement_status?: string
          improvement_type?: string | null
          notes?: string | null
          processed_at?: string | null
          ticket_id: string
        }
        Update: {
          affected_competency_id?: string | null
          affected_course_id?: string | null
          affected_lesson_id?: string | null
          auto_detected?: boolean
          classification?: string
          created_at?: string
          id?: string
          improvement_status?: string
          improvement_type?: string | null
          notes?: string | null
          processed_at?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_feedback_loop_affected_competency_id_fkey"
            columns: ["affected_competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_feedback_loop_affected_course_id_fkey"
            columns: ["affected_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_feedback_loop_affected_lesson_id_fkey"
            columns: ["affected_lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_qc_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_feedback_loop_affected_lesson_id_fkey"
            columns: ["affected_lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_feedback_loop_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_suggestions: {
        Row: {
          context_pattern: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          success_rate: number | null
          suggestion_text: string
          ticket_type: string
          times_accepted: number | null
          times_shown: number | null
        }
        Insert: {
          context_pattern?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          success_rate?: number | null
          suggestion_text: string
          ticket_type: string
          times_accepted?: number | null
          times_shown?: number | null
        }
        Update: {
          context_pattern?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          success_rate?: number | null
          suggestion_text?: string
          ticket_type?: string
          times_accepted?: number | null
          times_shown?: number | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          ai_response_count: number | null
          assigned_to: string | null
          auto_resolved: boolean | null
          auto_suggested_answer: string | null
          category: string | null
          context_competency_id: string | null
          context_course_id: string | null
          context_exam_session_id: string | null
          context_last_error: string | null
          context_learning_phase: string | null
          context_lesson_id: string | null
          context_readiness_score: number | null
          context_url: string | null
          created_at: string | null
          description: string
          feedback_rating: number | null
          id: string
          metadata: Json | null
          priority: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          sentiment: string | null
          status: string | null
          subject: string
          ticket_type: string | null
          updated_at: string | null
          user_id: string
          was_self_resolved: boolean | null
        }
        Insert: {
          ai_response_count?: number | null
          assigned_to?: string | null
          auto_resolved?: boolean | null
          auto_suggested_answer?: string | null
          category?: string | null
          context_competency_id?: string | null
          context_course_id?: string | null
          context_exam_session_id?: string | null
          context_last_error?: string | null
          context_learning_phase?: string | null
          context_lesson_id?: string | null
          context_readiness_score?: number | null
          context_url?: string | null
          created_at?: string | null
          description: string
          feedback_rating?: number | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sentiment?: string | null
          status?: string | null
          subject: string
          ticket_type?: string | null
          updated_at?: string | null
          user_id: string
          was_self_resolved?: boolean | null
        }
        Update: {
          ai_response_count?: number | null
          assigned_to?: string | null
          auto_resolved?: boolean | null
          auto_suggested_answer?: string | null
          category?: string | null
          context_competency_id?: string | null
          context_course_id?: string | null
          context_exam_session_id?: string | null
          context_last_error?: string | null
          context_learning_phase?: string | null
          context_lesson_id?: string | null
          context_readiness_score?: number | null
          context_url?: string | null
          created_at?: string | null
          description?: string
          feedback_rating?: number | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sentiment?: string | null
          status?: string | null
          subject?: string
          ticket_type?: string | null
          updated_at?: string | null
          user_id?: string
          was_self_resolved?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_context_competency_id_fkey"
            columns: ["context_competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_context_course_id_fkey"
            columns: ["context_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_context_exam_session_id_fkey"
            columns: ["context_exam_session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_context_lesson_id_fkey"
            columns: ["context_lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_qc_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_context_lesson_id_fkey"
            columns: ["context_lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
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
      system_optimization_reports: {
        Row: {
          created_at: string
          generated_by: string | null
          id: string
          metrics: Json
          recommendations: Json
          report_date: string
          report_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          generated_by?: string | null
          id?: string
          metrics?: Json
          recommendations?: Json
          report_date?: string
          report_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          generated_by?: string | null
          id?: string
          metrics?: Json
          recommendations?: Json
          report_date?: string
          report_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
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
      user_learning_streaks: {
        Row: {
          current_streak: number
          curriculum_id: string | null
          id: string
          last_activity_date: string | null
          longest_streak: number
          streak_start_date: string | null
          total_cards_reviewed: number
          total_sessions: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          curriculum_id?: string | null
          id?: string
          last_activity_date?: string | null
          longest_streak?: number
          streak_start_date?: string | null
          total_cards_reviewed?: number
          total_sessions?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          curriculum_id?: string | null
          id?: string
          last_activity_date?: string | null
          longest_streak?: number
          streak_start_date?: string | null
          total_cards_reviewed?: number
          total_sessions?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_learning_streaks_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
        ]
      }
      user_remediation_queue: {
        Row: {
          competency_id: string
          created_at: string
          curriculum_id: string
          id: string
          resolved_at: string | null
          score_at_detection: number
          source_session_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          competency_id: string
          created_at?: string
          curriculum_id: string
          id?: string
          resolved_at?: string | null
          score_at_detection?: number
          source_session_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          competency_id?: string
          created_at?: string
          curriculum_id?: string
          id?: string
          resolved_at?: string | null
          score_at_detection?: number
          source_session_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_remediation_queue_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_remediation_queue_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_remediation_queue_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
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
      vark_assessments: {
        Row: {
          auditory_score: number
          completed_at: string | null
          created_at: string
          id: string
          is_multimodal: boolean
          kinesthetic_score: number
          modality_profile: Json | null
          primary_type: string | null
          questions_answered: number
          raw_responses: Json | null
          reading_score: number
          secondary_type: string | null
          updated_at: string
          user_id: string
          visual_score: number
        }
        Insert: {
          auditory_score?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          is_multimodal?: boolean
          kinesthetic_score?: number
          modality_profile?: Json | null
          primary_type?: string | null
          questions_answered?: number
          raw_responses?: Json | null
          reading_score?: number
          secondary_type?: string | null
          updated_at?: string
          user_id: string
          visual_score?: number
        }
        Update: {
          auditory_score?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          is_multimodal?: boolean
          kinesthetic_score?: number
          modality_profile?: Json | null
          primary_type?: string | null
          questions_answered?: number
          raw_responses?: Json | null
          reading_score?: number
          secondary_type?: string | null
          updated_at?: string
          user_id?: string
          visual_score?: number
        }
        Relationships: []
      }
      weakness_assignments: {
        Row: {
          assigned_at: string
          competency_id: string
          curriculum_id: string
          id: string
          resolved_at: string | null
          retrained_lesson_ids: string[] | null
          score_at_detection: number
          source_session_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          competency_id: string
          curriculum_id: string
          id?: string
          resolved_at?: string | null
          retrained_lesson_ids?: string[] | null
          score_at_detection?: number
          source_session_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          competency_id?: string
          curriculum_id?: string
          id?: string
          resolved_at?: string | null
          retrained_lesson_ids?: string[] | null
          score_at_detection?: number
          source_session_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weakness_assignments_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weakness_assignments_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weakness_assignments_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      affiliate_referrals_safe: {
        Row: {
          affiliate_id: string | null
          commission_amount: number | null
          confirmed_at: string | null
          course_id: string | null
          id: string | null
          paid_at: string | null
          purchase_amount: number | null
          referred_at: string | null
          status: string | null
        }
        Insert: {
          affiliate_id?: string | null
          commission_amount?: number | null
          confirmed_at?: string | null
          course_id?: string | null
          id?: string | null
          paid_at?: string | null
          purchase_amount?: number | null
          referred_at?: string | null
          status?: string | null
        }
        Update: {
          affiliate_id?: string | null
          commission_amount?: number | null
          confirmed_at?: string | null
          course_id?: string | null
          id?: string | null
          paid_at?: string | null
          purchase_amount?: number | null
          referred_at?: string | null
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
      ai_cost_overview: {
        Row: {
          alert_sent_at: string | null
          alert_threshold: number | null
          budget_eur: number | null
          failed_requests: number | null
          month: string | null
          remaining_eur: number | null
          spent_eur: number | null
          total_requests: number | null
          total_tokens: number | null
          usage_percent: number | null
        }
        Insert: {
          alert_sent_at?: string | null
          alert_threshold?: number | null
          budget_eur?: number | null
          failed_requests?: never
          month?: string | null
          remaining_eur?: never
          spent_eur?: number | null
          total_requests?: never
          total_tokens?: never
          usage_percent?: never
        }
        Update: {
          alert_sent_at?: string | null
          alert_threshold?: number | null
          budget_eur?: number | null
          failed_requests?: never
          month?: string | null
          remaining_eur?: never
          spent_eur?: number | null
          total_requests?: never
          total_tokens?: never
          usage_percent?: never
        }
        Relationships: []
      }
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
      azav_dashboard_stats: {
        Row: {
          active_massnahmen: number | null
          approved_massnahmen: number | null
          approved_qm_docs: number | null
          audits_this_year: number | null
          compliance_rate: number | null
          draft_qm_docs: number | null
          expiring_soon: number | null
          overdue_reviews: number | null
          recent_audits: number | null
          recent_evidence_packs: number | null
          total_documents: number | null
          total_massnahmen: number | null
        }
        Relationships: []
      }
      blueprint_questions_view: {
        Row: {
          blueprint_id: string | null
          blueprint_name: string | null
          cognitive_level: Database["public"]["Enums"]["cognitive_level"] | null
          competency_code: string | null
          competency_title: string | null
          curriculum_title: string | null
          exam_relevance: Database["public"]["Enums"]["exam_relevance"] | null
          knowledge_type: Database["public"]["Enums"]["knowledge_type"] | null
          learning_field_code: string | null
          learning_field_title: string | null
          question_template: string | null
          status: Database["public"]["Enums"]["blueprint_status"] | null
          variable_count: number | null
          variant_count: number | null
          version: string | null
        }
        Relationships: []
      }
      curriculum_products_overview: {
        Row: {
          blueprint_id: string | null
          blueprint_title: string | null
          course_id: string | null
          course_title: string | null
          created_at: string | null
          created_by: string | null
          curriculum_id: string | null
          curriculum_status:
            | Database["public"]["Enums"]["curriculum_status"]
            | null
          curriculum_title: string | null
          generated_at: string | null
          generation_error: string | null
          generation_status: string | null
          id: string | null
          is_published: boolean | null
          product_id: string | null
          product_key: string | null
          product_name: string | null
          published_at: string | null
          quality_status: Json | null
          seo_description: string | null
          seo_title: string | null
          slug: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_products_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "exam_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_products_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_products_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
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
      lesson_qc_view: {
        Row: {
          competency_id: string | null
          created_at: string | null
          duration_minutes: number | null
          id: string | null
          minicheck_count: number | null
          module_id: string | null
          qc_exam_block: string | null
          qc_html: string | null
          qc_objectives: string[] | null
          qc_status: string | null
          qc_weight_tag: string | null
          sort_order: number | null
          status: string | null
          step: Database["public"]["Enums"]["lesson_step"] | null
          title: string | null
        }
        Insert: {
          competency_id?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string | null
          minicheck_count?: never
          module_id?: string | null
          qc_exam_block?: never
          qc_html?: never
          qc_objectives?: never
          qc_status?: string | null
          qc_weight_tag?: never
          sort_order?: number | null
          status?: string | null
          step?: Database["public"]["Enums"]["lesson_step"] | null
          title?: string | null
        }
        Update: {
          competency_id?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string | null
          minicheck_count?: never
          module_id?: string | null
          qc_exam_block?: never
          qc_html?: never
          qc_objectives?: never
          qc_status?: string | null
          qc_weight_tag?: never
          sort_order?: number | null
          status?: string | null
          step?: Database["public"]["Enums"]["lesson_step"] | null
          title?: string | null
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
      ops_cost_summary: {
        Row: {
          day: string | null
          errors: number | null
          job_type: string | null
          runs: number | null
          total_cost: number | null
          total_tokens: number | null
        }
        Relationships: []
      }
      ops_job_summary: {
        Row: {
          avg_duration_seconds: number | null
          job_count: number | null
          last_24h: number | null
          last_hour: number | null
          latest_created: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      assert_job_payload: { Args: { job: Json }; Returns: undefined }
      assert_profiles_rls_secure: { Args: never; Returns: undefined }
      attempt_auto_recovery: { Args: { p_alert_id: string }; Returns: Json }
      calculate_daily_kpis: { Args: never; Returns: Json }
      calculate_exam_readiness: {
        Args: { p_curriculum_id: string; p_user_id: string }
        Returns: Json
      }
      calculate_product_price: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: {
          tier_name: string
          total_price_cents: number
          unit_price_cents: number
        }[]
      }
      calculate_readiness_score: {
        Args: { p_curriculum_id: string; p_user_id: string }
        Returns: {
          days_until_ready: number
          overall_readiness: number
          predicted_exam_score: number
          strong_areas: Json
          trend: string
          weak_areas: Json
        }[]
      }
      calculate_sm2_next_review: {
        Args: {
          p_bloom_level: string
          p_current_ease: number
          p_current_interval: number
          p_quality: number
          p_repetition_count: number
        }
        Returns: {
          is_lapse: boolean
          new_ease_factor: number
          new_interval: number
          new_repetition_count: number
        }[]
      }
      can_worker_claim: { Args: { p_job_type: string }; Returns: boolean }
      check_lesson_progression: {
        Args: { p_lesson_id: string; p_user_id: string }
        Returns: Json
      }
      check_simulation_gate: {
        Args: { p_curriculum_id: string; p_user_id: string }
        Returns: Json
      }
      check_user_entitlement: {
        Args: { p_curriculum_id: string; p_feature: string; p_user_id: string }
        Returns: boolean
      }
      claim_license_seat: { Args: { p_invite_code: string }; Returns: string }
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
      create_enterprise_account: {
        Args: {
          p_email?: string
          p_first_name: string
          p_last_name: string
          p_package_id: string
          p_personnel_number?: string
          p_seat_id: string
          p_username: string
        }
        Returns: string
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
      create_weakness_assignments_from_exam: {
        Args: { p_session_id: string }
        Returns: number
      }
      export_course_pack: {
        Args: {
          p_course_id: string
          p_include_h5p?: boolean
          p_include_questions?: boolean
        }
        Returns: Json
      }
      export_ledger_csv: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          belegnummer: string
          betrag_eur: number
          buchungsdatum: string
          buchungstext: string
          gegenkonto: string
          konto: string
          steuer_prozent: number
          waehrung: string
        }[]
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
      generate_invite_code: { Args: never; Returns: string }
      generate_invoice_number: { Args: never; Returns: string }
      get_adaptive_recommendation: {
        Args: { p_curriculum_id: string; p_user_id: string }
        Returns: Json
      }
      get_bloom_level_stats: {
        Args: { p_curriculum_id: string }
        Returns: {
          bloom_level: string
          description: string
          ihk_weight: number
          question_count: number
        }[]
      }
      get_content_quality_stats: {
        Args: never
        Returns: {
          placeholder_count: number
          quality_percent: number
          total_lessons: number
          valid_lessons: number
        }[]
      }
      get_course_progress: { Args: { p_course_id: string }; Returns: Json }
      get_due_cards: {
        Args: {
          p_curriculum_id?: string
          p_include_new?: boolean
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          bloom_level: string
          card_id: string
          correct_answer: number
          ease_factor: number
          interval_days: number
          is_new: boolean
          options: Json
          question_id: string
          question_text: string
          repetition_count: number
        }[]
      }
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
      get_exam_readiness: {
        Args: { p_curriculum_id: string; p_user_id: string }
        Returns: Json
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
      get_my_profile: {
        Args: never
        Returns: {
          avatar_url: string
          company_id: string
          created_at: string
          full_name: string
          id: string
          login_username: string
          managed_account: boolean
          updated_at: string
          user_id: string
        }[]
      }
      get_placeholder_lessons: {
        Args: { p_course_id?: string; p_limit?: number }
        Returns: {
          competency_code: string
          competency_description: string
          competency_taxonomy_level: string
          competency_title: string
          content: Json
          course_id: string
          id: string
          step: string
          title: string
        }[]
      }
      get_profiles_security_status: { Args: never; Returns: Json }
      get_user_dashboard_stats: { Args: never; Returns: Json }
      get_user_entitlements: {
        Args: { p_curriculum_id?: string; p_user_id: string }
        Returns: {
          curriculum_id: string
          has_ai_tutor: boolean
          has_exam_trainer: boolean
          has_learning_course: boolean
          has_oral_trainer: boolean
          valid_until: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hash_email: { Args: { p_email: string }; Returns: string }
      is_admin_user: { Args: { check_uid: string }; Returns: boolean }
      job_maintenance: { Args: never; Returns: Json }
      job_recovery_worker: { Args: never; Returns: Json }
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
      normalize_search_text: { Args: { input: string }; Returns: string }
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
      report_audit_log: {
        Args: { p_limit?: number }
        Returns: {
          account: string
          amount_cents: number
          currency: string
          description: string
          event_time: string
          event_type: string
          id: string
          order_id: string
          stripe_event_id: string
        }[]
      }
      report_fees_refunds_by_month: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          chargebacks_cents: number
          month: string
          refunds_cents: number
          stripe_fees_cents: number
        }[]
      }
      report_open_items: {
        Args: never
        Returns: {
          buyer_email: string
          created_at: string
          order_id: string
          paid_cents: number
          status: string
          total_cents: number
        }[]
      }
      report_payouts: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          month: string
          payout_cents: number
          payout_count: number
        }[]
      }
      report_revenue_by_month: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          gross_cents: number
          month: string
          net_cents: number
          order_count: number
          tax_cents: number
        }[]
      }
      report_revenue_by_product: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          gross_cents: number
          product_id: string
          product_name: string
          quantity: number
        }[]
      }
      report_vat_by_rate: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          month: string
          revenue_net_cents: number
          tax_cents: number
          tax_rate: number
        }[]
      }
      requeue_failed_jobs: { Args: never; Returns: number }
      run_azav_compliance_check: {
        Args: never
        Returns: {
          actual_value: string
          category: string
          check_code: string
          check_name: string
          priority: string
          result: string
        }[]
      }
      run_health_checks: { Args: never; Returns: Json }
      search_berufe: {
        Args: { lim?: number; q: string }
        Returns: {
          id: string
          match_reason: string
          score: number
          subtitle: string
          title: string
          type: string
          url: string
        }[]
      }
      search_public: {
        Args: { lim?: number; q: string; types?: string[] }
        Returns: {
          id: string
          match_reason: string
          score: number
          subtitle: string
          title: string
          type: string
          url: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
      start_weakness_exam_session: {
        Args: { p_blueprint_id: string }
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
      unaccent: { Args: { "": string }; Returns: string }
      update_learning_streak: {
        Args: { p_curriculum_id: string; p_user_id: string }
        Returns: {
          current_streak: number
          longest_streak: number
          streak_continued: boolean
        }[]
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
      update_spaced_repetition: {
        Args: {
          p_is_correct: boolean
          p_question_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      validate_blueprint_constraints: {
        Args: { p_blueprint_id: string; p_variable_values: Json }
        Returns: {
          errors: string[]
          is_valid: boolean
        }[]
      }
      verify_evidence_pack_integrity: {
        Args: { p_pack_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "learner"
      bloom_level:
        | "remember"
        | "understand"
        | "apply"
        | "analyze"
        | "evaluate"
        | "create"
      blueprint_status: "draft" | "review" | "approved" | "deprecated"
      cognitive_level: "remember" | "understand" | "apply" | "analyze"
      course_status: "draft" | "generating" | "published" | "archived"
      curriculum_status: "draft" | "extracting" | "normalizing" | "frozen"
      didactic_intent:
        | "transfer"
        | "recognition"
        | "error_detection"
        | "comparison"
        | "classification"
      distractor_error_type:
        | "common_misconception"
        | "overgeneralization"
        | "irrelevant_fact"
        | "partial_truth"
        | "outdated_info"
        | "confusing_similar"
      exam_mode: "simulation" | "practice" | "timed_exam"
      exam_relevance: "low" | "medium" | "high"
      knowledge_type: "concept" | "procedure" | "calculation" | "regulation"
      lesson_step:
        | "einstieg"
        | "verstehen"
        | "anwenden"
        | "wiederholen"
        | "mini_check"
      question_difficulty: "easy" | "medium" | "hard"
      question_status: "draft" | "review" | "approved" | "rejected"
      variation_mode:
        | "lexical"
        | "numerical"
        | "contextual"
        | "distractor_rotation"
      vark_type: "visual" | "auditory" | "reading" | "kinesthetic"
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
      bloom_level: [
        "remember",
        "understand",
        "apply",
        "analyze",
        "evaluate",
        "create",
      ],
      blueprint_status: ["draft", "review", "approved", "deprecated"],
      cognitive_level: ["remember", "understand", "apply", "analyze"],
      course_status: ["draft", "generating", "published", "archived"],
      curriculum_status: ["draft", "extracting", "normalizing", "frozen"],
      didactic_intent: [
        "transfer",
        "recognition",
        "error_detection",
        "comparison",
        "classification",
      ],
      distractor_error_type: [
        "common_misconception",
        "overgeneralization",
        "irrelevant_fact",
        "partial_truth",
        "outdated_info",
        "confusing_similar",
      ],
      exam_mode: ["simulation", "practice", "timed_exam"],
      exam_relevance: ["low", "medium", "high"],
      knowledge_type: ["concept", "procedure", "calculation", "regulation"],
      lesson_step: [
        "einstieg",
        "verstehen",
        "anwenden",
        "wiederholen",
        "mini_check",
      ],
      question_difficulty: ["easy", "medium", "hard"],
      question_status: ["draft", "review", "approved", "rejected"],
      variation_mode: [
        "lexical",
        "numerical",
        "contextual",
        "distractor_rotation",
      ],
      vark_type: ["visual", "auditory", "reading", "kinesthetic"],
    },
  },
} as const
