/**
 * Learner Image SSOT — re-exports + Learner-spezifische Defaults.
 *
 * Hält Image-Auflösung learner-seitig konsistent zum Shop. Bei fehlendem
 * expliziten Cover wird das berufspassende Bild aus `getBerufImage` gezogen.
 */
export {
  resolveCourseImage,
  COURSE_CARD_SIZES,
  COURSE_HERO_SIZES,
} from "@/lib/courseImage";

/** Spezifischer sizes-Hint für Learner-Hero (volle Breite, Desktop kappt bei ~960px). */
export const LEARNER_HERO_SIZES = "(min-width: 1280px) 960px, 100vw";

/** Spezifischer sizes-Hint für kompakte Learner-Lesson-Cards (3-spaltig). */
export const LEARNER_LESSON_CARD_SIZES =
  "(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw";
