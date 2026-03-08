export type ProductionWaveTemplate = {
  key: string;
  label: string;
  description: string;
  limit: number;
  maxConcurrent: number;
  priorityMin: number;
  priorityMax: number;
  track: string | null;
  dryRun: boolean;
};

export const PRODUCTION_WAVE_TEMPLATES: ProductionWaveTemplate[] = [
  {
    key: "canary_5",
    label: "Canary 5",
    description: "Sehr kleine Sicherheitswelle zur Validierung",
    limit: 5,
    maxConcurrent: 3,
    priorityMin: 1,
    priorityMax: 10,
    track: "AUSBILDUNG_VOLL",
    dryRun: false,
  },
  {
    key: "batch_20",
    label: "Batch 20",
    description: "Kontrollierte Produktionswelle",
    limit: 20,
    maxConcurrent: 6,
    priorityMin: 1,
    priorityMax: 10,
    track: "AUSBILDUNG_VOLL",
    dryRun: false,
  },
  {
    key: "scale_100",
    label: "Scale 100",
    description: "Skalierter Produktionslauf",
    limit: 100,
    maxConcurrent: 10,
    priorityMin: 1,
    priorityMax: 10,
    track: "AUSBILDUNG_VOLL",
    dryRun: false,
  },
  {
    key: "bulk_500",
    label: "Bulk 500",
    description: "Großlauf für Massenproduktion",
    limit: 500,
    maxConcurrent: 15,
    priorityMin: 1,
    priorityMax: 10,
    track: "AUSBILDUNG_VOLL",
    dryRun: false,
  },
  {
    key: "dry_run_20",
    label: "Dry Run 20",
    description: "Nur Auswahl simulieren, nichts anlegen",
    limit: 20,
    maxConcurrent: 6,
    priorityMin: 1,
    priorityMax: 10,
    track: "AUSBILDUNG_VOLL",
    dryRun: true,
  },
];
