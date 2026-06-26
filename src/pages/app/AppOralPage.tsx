/**
 * /app/oral — SSOT-Route für den Mündlichen Trainer.
 *
 * Konsolidierung 2026-06-26: Die frühere cinematic "Diagnostik-Demo" wurde
 * durch den produktiven OralExamTrainer ersetzt (Voice STT/TTS, Scoring,
 * oral_exam_sessions/turns-Persistenz, oral-exam Edge Function).
 *
 * Die alte Route /oral-exam redirected nach /app/oral?curriculum=… —
 * /app/oral ist ab jetzt die einzige Mündlich-Trainer-Surface.
 *
 * Frühere Demo siehe Git-Historie (Phase 5.2 Diagnostik-Stub).
 */
import OralExamTrainer from "@/pages/OralExamTrainer";

export default function AppOralPage() {
  return <OralExamTrainer />;
}
