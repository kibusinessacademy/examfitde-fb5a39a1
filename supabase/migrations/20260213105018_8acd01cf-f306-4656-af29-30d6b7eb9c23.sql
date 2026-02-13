
-- Add seeding_template column
ALTER TABLE public.german_certification_master
  ADD COLUMN IF NOT EXISTS seeding_template jsonb DEFAULT '{}'::jsonb;

-- Seed Wirtschaftsfachwirt (IHK) as Pilot
INSERT INTO public.german_certification_master (
  name, cluster, traeger, track, pruefungsart,
  min_fragen_target, oral_required,
  dominance_phase, dominance_score,
  priority_rank, wave,
  marktgroesse, wettbewerb_level,
  seeding_status,
  seeding_template
) VALUES (
  'Wirtschaftsfachwirt (IHK)',
  'ihk_aufstieg',
  'IHK',
  'EXAM_FIRST',
  'gemischt',
  1200,
  true,
  'phase_1_analyse',
  0,
  1,
  1,
  'sehr_gross',
  'mittel',
  'pending',
  '{
    "exam_parts": [
      {
        "name": "Teil 1: Wirtschaftsbezogene Qualifikationen",
        "weight_pct": 50,
        "domains": [
          {"name": "Volks- und Betriebswirtschaft", "weight_pct": 15, "question_target": 180},
          {"name": "Rechnungswesen", "weight_pct": 15, "question_target": 180},
          {"name": "Recht und Steuern", "weight_pct": 10, "question_target": 120},
          {"name": "Unternehmensführung", "weight_pct": 10, "question_target": 120}
        ]
      },
      {
        "name": "Teil 2: Handlungsspezifische Qualifikationen",
        "weight_pct": 50,
        "domains": [
          {"name": "Betriebliches Management", "weight_pct": 12, "question_target": 150},
          {"name": "Investition, Finanzierung, betriebliches Rechnungswesen und Controlling", "weight_pct": 13, "question_target": 150},
          {"name": "Logistik", "weight_pct": 8, "question_target": 100},
          {"name": "Marketing und Vertrieb", "weight_pct": 10, "question_target": 120},
          {"name": "Führung und Zusammenarbeit", "weight_pct": 7, "question_target": 100}
        ]
      }
    ],
    "oral_structure": {
      "preparation_minutes": 10,
      "presentation_minutes": 10,
      "discussion_minutes": 20,
      "scenario_target": 100,
      "fachgespraech_target": 150,
      "rubric_criteria": ["Struktur", "Argumentation", "Praxisbezug", "Fachlichkeit", "Zeitmanagement"]
    },
    "difficulty_distribution": {"leicht": 5, "mittel": 55, "schwer": 40},
    "quality_gates": {
      "coverage_min_pct": 95,
      "duplicate_max_pct": 2,
      "confidence_min": 90,
      "governance_min": 90,
      "hard_fail_tolerance": 0
    },
    "question_total_target": 1300
  }'::jsonb
)
ON CONFLICT DO NOTHING;
