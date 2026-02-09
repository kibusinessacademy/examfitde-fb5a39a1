import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Spaced Repetition Service - SM-2 Algorithm with Bloom's Taxonomy Modifiers
 * 
 * Implements:
 * - SM-2 spaced repetition algorithm
 * - Bloom's Taxonomy difficulty modifiers
 * - Streak tracking
 * - IHK-weighted question selection
 */

// Bloom's Taxonomy IHK Weights
const BLOOM_IHK_WEIGHTS = {
  remember: { modifier: 1.0, weight: 0.10, description: 'Erinnern' },
  understand: { modifier: 1.05, weight: 0.25, description: 'Verstehen' },
  apply: { modifier: 1.10, weight: 0.35, description: 'Anwenden' },
  analyze: { modifier: 1.15, weight: 0.20, description: 'Analysieren' },
  evaluate: { modifier: 1.20, weight: 0.07, description: 'Bewerten' },
  create: { modifier: 1.25, weight: 0.03, description: 'Erschaffen' },
} as const;

type BloomLevel = keyof typeof BLOOM_IHK_WEIGHTS;

interface SM2Result {
  newEaseFactor: number;
  newInterval: number;
  newRepetitionCount: number;
  isLapse: boolean;
}

/**
 * SM-2 Algorithm Implementation with Bloom's Taxonomy Modifiers
 */
function calculateSM2(
  quality: number,         // 0-5 rating
  currentEase: number,     // Current ease factor (default 2.5)
  currentInterval: number, // Current interval in days
  repetitionCount: number, // Number of successful reviews
  bloomLevel: BloomLevel   // Bloom's taxonomy level
): SM2Result {
  const bloomModifier = BLOOM_IHK_WEIGHTS[bloomLevel]?.modifier || 1.0;
  
  let newEase: number;
  let newInterval: number;
  let newReps: number;
  let isLapse = false;

  if (quality < 3) {
    // Failed: Reset to beginning
    newReps = 0;
    newInterval = 1;
    isLapse = true;
    // Decrease ease factor but not below 1.3
    newEase = Math.max(1.3, currentEase - 0.2);
  } else {
    // Passed: Apply SM-2 formula
    newReps = repetitionCount + 1;
    
    // Calculate new ease factor (SM-2 formula)
    newEase = currentEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    newEase = Math.max(1.3, newEase);
    
    // Calculate new interval with Bloom's modifier
    if (newReps === 1) {
      newInterval = 1;
    } else if (newReps === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.ceil(currentInterval * newEase * bloomModifier);
    }
  }

  // Cap interval at 365 days
  newInterval = Math.min(newInterval, 365);

  return {
    newEaseFactor: Math.round(newEase * 100) / 100,
    newInterval,
    newRepetitionCount: newReps,
    isLapse,
  };
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { action, ...params } = await req.json();

    // Auth check
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

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result;

    switch (action) {
      case 'start_session':
        result = await startSession(supabase, user.id, params);
        break;
      case 'get_due_cards':
        result = await getDueCards(supabase, user.id, params);
        break;
      case 'submit_review':
        result = await submitReview(supabase, user.id, params);
        break;
      case 'finish_session':
        result = await finishSession(supabase, user.id, params);
        break;
      case 'get_stats':
        result = await getStats(supabase, user.id, params);
        break;
      case 'initialize_cards':
        result = await initializeCards(supabase, user.id, params);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Spaced repetition error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Start a new spaced repetition session
 */
async function startSession(supabase: any, userId: string, params: any) {
  const { curriculum_id, max_cards = 20 } = params;

  // Create session
  const { data: session, error: sessionError } = await supabase
    .from('spaced_repetition_sessions')
    .insert({
      user_id: userId,
      curriculum_id,
      total_cards: 0,
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  // Get due cards
  const { data: cards, error: cardsError } = await supabase.rpc('get_due_cards', {
    p_user_id: userId,
    p_curriculum_id: curriculum_id,
    p_limit: max_cards,
    p_include_new: true,
  });

  if (cardsError) throw cardsError;

  // Update session with card counts
  const newCards = cards?.filter((c: any) => c.is_new).length || 0;
  const reviewCards = (cards?.length || 0) - newCards;

  await supabase
    .from('spaced_repetition_sessions')
    .update({
      total_cards: cards?.length || 0,
      new_cards: newCards,
      review_cards: reviewCards,
    })
    .eq('id', session.id);

  return {
    session: { ...session, total_cards: cards?.length || 0, new_cards: newCards, review_cards: reviewCards },
    cards: cards || [],
    bloom_weights: BLOOM_IHK_WEIGHTS,
  };
}

/**
 * Get due cards for review
 */
async function getDueCards(supabase: any, userId: string, params: any) {
  const { curriculum_id, limit = 20, include_new = true } = params;

  const { data: cards, error } = await supabase.rpc('get_due_cards', {
    p_user_id: userId,
    p_curriculum_id: curriculum_id || null,
    p_limit: limit,
    p_include_new: include_new,
  });

  if (error) throw error;

  return { cards: cards || [] };
}

/**
 * Submit a card review
 */
async function submitReview(supabase: any, userId: string, params: any) {
  const { card_id, quality_rating, response_time_ms, session_id } = params;

  // Get current card state
  const { data: card, error: cardError } = await supabase
    .from('spaced_repetition_cards')
    .select('*')
    .eq('id', card_id)
    .eq('user_id', userId)
    .single();

  if (cardError) throw cardError;

  // Calculate new SM-2 values
  const sm2Result = calculateSM2(
    quality_rating,
    card.ease_factor,
    card.interval_days,
    card.repetition_count,
    card.bloom_level as BloomLevel
  );

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + sm2Result.newInterval);

  // Create review record
  const { error: reviewError } = await supabase
    .from('spaced_repetition_reviews')
    .insert({
      card_id,
      user_id: userId,
      quality_rating,
      previous_ease_factor: card.ease_factor,
      previous_interval: card.interval_days,
      new_ease_factor: sm2Result.newEaseFactor,
      new_interval: sm2Result.newInterval,
      bloom_level: card.bloom_level,
      response_time_ms,
    });

  if (reviewError) throw reviewError;

  // Update card
  const { error: updateError } = await supabase
    .from('spaced_repetition_cards')
    .update({
      ease_factor: sm2Result.newEaseFactor,
      interval_days: sm2Result.newInterval,
      repetition_count: sm2Result.newRepetitionCount,
      next_review_at: nextReviewAt.toISOString(),
      last_reviewed_at: new Date().toISOString(),
      is_new: false,
      is_graduated: sm2Result.newRepetitionCount >= 3,
      lapses: sm2Result.isLapse ? card.lapses + 1 : card.lapses,
    })
    .eq('id', card_id);

  if (updateError) throw updateError;

  // Update session stats if provided
  if (session_id) {
    const field = quality_rating >= 3 ? 'correct_count' : 'incorrect_count';
    await supabase.rpc('increment_field', { 
      table_name: 'spaced_repetition_sessions',
      field_name: field,
      row_id: session_id,
    }).catch(() => {
      // Fallback: direct update
      supabase.from('spaced_repetition_sessions')
        .update({ [field]: supabase.raw(`${field} + 1`) })
        .eq('id', session_id);
    });
  }

  return {
    success: true,
    result: sm2Result,
    next_review_at: nextReviewAt.toISOString(),
  };
}

/**
 * Finish a spaced repetition session
 */
async function finishSession(supabase: any, userId: string, params: any) {
  const { session_id, curriculum_id } = params;

  // Get session
  const { data: session, error: sessionError } = await supabase
    .from('spaced_repetition_sessions')
    .select('*')
    .eq('id', session_id)
    .eq('user_id', userId)
    .single();

  if (sessionError) throw sessionError;

  // Calculate duration
  const startedAt = new Date(session.started_at);
  const durationSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

  // Update streak
  const { data: streakData } = await supabase.rpc('update_learning_streak', {
    p_user_id: userId,
    p_curriculum_id: curriculum_id,
  });

  // Finish session
  const { data: finishedSession, error: finishError } = await supabase
    .from('spaced_repetition_sessions')
    .update({
      finished_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      streak_continued: streakData?.[0]?.streak_continued || false,
    })
    .eq('id', session_id)
    .select()
    .single();

  if (finishError) throw finishError;

  return {
    session: finishedSession,
    streak: streakData?.[0] || null,
    summary: {
      total_cards: session.total_cards,
      correct: session.correct_count,
      incorrect: session.incorrect_count,
      accuracy: session.total_cards > 0 
        ? Math.round((session.correct_count / session.total_cards) * 100) 
        : 0,
      duration_seconds: durationSeconds,
    },
  };
}

/**
 * Get user statistics
 */
async function getStats(supabase: any, userId: string, params: any) {
  const { curriculum_id } = params;

  // Get streak
  const { data: streak } = await supabase
    .from('user_learning_streaks')
    .select('*')
    .eq('user_id', userId)
    .eq('curriculum_id', curriculum_id)
    .single();

  // Get card counts
  const { data: cardStats } = await supabase
    .from('spaced_repetition_cards')
    .select('is_new, is_graduated, bloom_level')
    .eq('user_id', userId)
    .eq('curriculum_id', curriculum_id);

  // Get due count
  const { count: dueCount } = await supabase
    .from('spaced_repetition_cards')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('curriculum_id', curriculum_id)
    .lte('next_review_at', new Date().toISOString())
    .eq('is_suspended', false);

  // Calculate stats
  const totalCards = cardStats?.length || 0;
  const newCards = cardStats?.filter((c: any) => c.is_new).length || 0;
  const graduatedCards = cardStats?.filter((c: any) => c.is_graduated).length || 0;
  
  // Bloom level distribution
  const bloomDistribution = Object.keys(BLOOM_IHK_WEIGHTS).reduce((acc, level) => {
    acc[level] = cardStats?.filter((c: any) => c.bloom_level === level).length || 0;
    return acc;
  }, {} as Record<string, number>);

  return {
    streak: streak || { current_streak: 0, longest_streak: 0, total_sessions: 0 },
    cards: {
      total: totalCards,
      new: newCards,
      learning: totalCards - newCards - graduatedCards,
      graduated: graduatedCards,
      due: dueCount || 0,
    },
    bloom_distribution: bloomDistribution,
    bloom_weights: BLOOM_IHK_WEIGHTS,
  };
}

/**
 * Initialize cards for a curriculum from exam questions
 */
async function initializeCards(supabase: any, userId: string, params: any) {
  const { curriculum_id, limit = 100 } = params;

  // Get existing card question IDs
  const { data: existingCards } = await supabase
    .from('spaced_repetition_cards')
    .select('question_id')
    .eq('user_id', userId)
    .eq('curriculum_id', curriculum_id);

  const existingQuestionIds = new Set(existingCards?.map((c: any) => c.question_id) || []);

  // Get approved questions that aren't already cards
  const { data: questions, error: questionsError } = await supabase
    .from('exam_questions')
    .select(`
      id,
      competency_id,
      difficulty,
      competency:competencies(
        id,
        learning_field_id
      )
    `)
    .eq('curriculum_id', curriculum_id)
    .eq('status', 'approved')
    .limit(limit);

  if (questionsError) throw questionsError;

  // Filter out existing and map to cards
  const newCards = (questions || [])
    .filter((q: any) => !existingQuestionIds.has(q.id))
    .map((q: any) => ({
      user_id: userId,
      curriculum_id,
      question_id: q.id,
      competency_id: q.competency_id,
      // Map difficulty to Bloom level
      bloom_level: mapDifficultyToBloom(q.difficulty),
    }));

  if (newCards.length === 0) {
    return { created: 0, message: 'No new cards to create' };
  }

  // Insert cards
  const { data: createdCards, error: insertError } = await supabase
    .from('spaced_repetition_cards')
    .insert(newCards)
    .select();

  if (insertError) throw insertError;

  return {
    created: createdCards?.length || 0,
    message: `${createdCards?.length || 0} new cards initialized`,
  };
}

function mapDifficultyToBloom(difficulty: string): BloomLevel {
  switch (difficulty) {
    case 'easy':
      return 'remember';
    case 'medium':
      return 'understand';
    case 'hard':
      return 'apply';
    default:
      return 'understand';
  }
}
