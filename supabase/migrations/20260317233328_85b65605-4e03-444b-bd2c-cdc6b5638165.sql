
-- ============================================================
-- BLOOM TAXONOMY FIX: Kaufmann/-frau für Büromanagement
-- Curriculum: 33eb7832-8c80-46fa-a3ad-a9a5ee996e87
-- BEFORE: remember=32.6%, understand=0%, apply=34.7%, analyze=32.8%, evaluate=0%
-- TARGET: remember~15%, understand~15%, apply~30%, analyze~20%, evaluate~12%
-- ============================================================

-- PHASE 1: Reclassify → UNDERSTAND (keyword heuristic, exclude evaluate patterns)
UPDATE exam_questions
SET cognitive_level = 'understand'
WHERE id IN (
  SELECT eq.id
  FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE eq.status = 'approved'
    AND lf.curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
    AND eq.cognitive_level IN ('remember', 'apply', 'analyze')
    AND eq.question_text ~* '(warum|erklär|unterschied|zusammenhang|bedeutung|zweck|funktion|rolle spielt|prinzip|worin besteht|wodurch|weshalb|begründ|aus welchem grund|vorteil|nachteil|welchen einfluss|auswirkung|folge|konsequenz|was bewirkt|was passiert|was bedeutet|was versteht man|welche bedeutung|welche funktion|welche rolle|welcher zusammenhang|wieso|wofür|wozu|inwiefern|welche auswirkung|welchen effekt|welche wirkung|was geschieht|in welchem zusammenhang|welche ursache|was kennzeichnet|wie wirkt sich|was unterscheidet|welches merkmal|welches kennzeichen|wie lässt sich erklären|welche eigenschaft)'
    AND NOT eq.question_text ~* '(welche maßnahme|am besten|am sinnvollsten|am effektivsten|am erfolgversprechendsten|sollte.*ergreifen|sollte.*priorisier|was raten|empfehlen|am geeignetsten|am zweckmäßigsten|welche strategie|sollte.*bevorzug|welche option|welche vorgehensweise|als erstes|sofort ergriffen|größten effekt|wichtigste schritt)'
);

-- PHASE 2: Reclassify → EVALUATE (decision/recommendation heuristic from remember pool)
UPDATE exam_questions
SET cognitive_level = 'evaluate'
WHERE id IN (
  SELECT eq.id
  FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE eq.status = 'approved'
    AND lf.curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
    AND eq.cognitive_level = 'remember'
    AND eq.question_text ~* '(welche maßnahme|am besten|am sinnvollsten|am effektivsten|am erfolgversprechendsten|sollte.*ergreifen|sollte.*priorisier|was raten|empfehlen|am geeignetsten|am zweckmäßigsten|welche strategie|sollte.*bevorzug|welche option|welche vorgehensweise|als erstes|sofort ergriffen|größten effekt|wichtigste schritt)'
);

-- PHASE 3: Fill remaining understand gap from overrepresented analyze pool
-- Take analyze+easy questions (both categories excess) → understand, capped at 1100
UPDATE exam_questions
SET cognitive_level = 'understand'
WHERE id IN (
  SELECT eq.id
  FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE eq.status = 'approved'
    AND lf.curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
    AND eq.cognitive_level = 'analyze'
    AND eq.difficulty = 'easy'
    AND NOT eq.question_text ~* '(fehler.*identifiz|fehler.*find|was.*falsch|welcher.*fehler|analysier|diagnostiz|ursache.*ermitteln)'
  ORDER BY random()
  LIMIT 1100
);

-- PHASE 4: Fix difficulty - easy is 32.6%, target less than 15%
UPDATE exam_questions
SET difficulty = 'medium'
WHERE id IN (
  SELECT eq.id
  FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE eq.status = 'approved'
    AND lf.curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
    AND eq.difficulty = 'easy'
    AND eq.question_text ~* '(berechnung|prozent|kalkulation|formel|ermitteln sie|wie hoch|welcher betrag|optimier|analyse|vergleich|maßnahme|strategie|bewerten|beurteilen|priorisier|empfehlen)'
)
