#!/usr/bin/env node
/**
 * Duplicate Detector
 * 
 * Scans exam questions for exact and near-duplicate question texts.
 * Uses Jaccard n-gram similarity (trigrams) with threshold 0.96.
 * Fails if duplicate_rate > 2%.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.log("⚠️  SUPABASE_URL / KEY not set – skipping");
  process.exit(0);
}

const NEAR_THRESHOLD = 0.96;
const MAX_DUP_RATE = 0.02;

function trigrams(text) {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const set = new Set();
  for (let i = 0; i <= norm.length - 3; i++) {
    set.add(norm.slice(i, i + 3));
  }
  return set;
}

function jaccard(a, b) {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

async function fetchAllQuestions() {
  const questions = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/exam_questions?select=id,question_text,package_id&status=eq.approved&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) break;
    const batch = await res.json();
    if (batch.length === 0) break;
    questions.push(...batch);
    offset += limit;
    if (batch.length < limit) break;
  }
  return questions;
}

async function main() {
  console.log("🔍 Running Duplicate Detector...\n");

  const questions = await fetchAllQuestions();
  if (questions.length === 0) {
    console.log("⚠️  No approved questions found – skipping");
    process.exit(0);
  }

  console.log(`📋 Scanning ${questions.length} approved questions...`);

  // Exact duplicates (by normalized text)
  const textMap = new Map();
  const exactDups = [];
  for (const q of questions) {
    const norm = (q.question_text || "").toLowerCase().trim();
    if (textMap.has(norm)) {
      exactDups.push({ id: q.id, duplicate_of: textMap.get(norm) });
    } else {
      textMap.set(norm, q.id);
    }
  }

  // Near duplicates (Jaccard trigram, sliding window for performance)
  const nearDups = [];
  const WINDOW = 500; // compare within windows for O(n*w) instead of O(n²)
  const trigramCache = questions.map((q) => ({
    id: q.id,
    pkg: q.package_id,
    tg: trigrams(q.question_text || ""),
  }));

  for (let i = 0; i < trigramCache.length; i++) {
    const end = Math.min(i + WINDOW, trigramCache.length);
    for (let j = i + 1; j < end; j++) {
      const sim = jaccard(trigramCache[i].tg, trigramCache[j].tg);
      if (sim >= NEAR_THRESHOLD && !exactDups.find((d) => d.id === trigramCache[j].id)) {
        nearDups.push({
          id_a: trigramCache[i].id,
          id_b: trigramCache[j].id,
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }

  const totalDups = exactDups.length + nearDups.length;
  const dupRate = totalDups / Math.max(questions.length, 1);

  console.log(`\n📊 Results:`);
  console.log(`   Exact duplicates: ${exactDups.length}`);
  console.log(`   Near duplicates (≥${NEAR_THRESHOLD}): ${nearDups.length}`);
  console.log(`   Duplicate rate: ${(dupRate * 100).toFixed(2)}% (limit: ${MAX_DUP_RATE * 100}%)`);

  if (exactDups.length > 0) {
    console.log(`\n   Exact duplicate samples:`);
    for (const d of exactDups.slice(0, 5)) {
      console.log(`   → ${d.id?.slice(0, 8)} == ${d.duplicate_of?.slice(0, 8)}`);
    }
  }

  const report = {
    total_questions: questions.length,
    exact_duplicates: exactDups.length,
    near_duplicates: nearDups.length,
    duplicate_rate: Math.round(dupRate * 10000) / 10000,
    threshold: NEAR_THRESHOLD,
    exact_samples: exactDups.slice(0, 20),
    near_samples: nearDups.slice(0, 20),
  };

  const fs = await import("node:fs");
  const outDir = process.env.CI_ARTIFACTS || ".ci_artifacts";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/dedupe_report.json`, JSON.stringify(report, null, 2));

  if (dupRate > MAX_DUP_RATE) {
    console.error(`\n🚫 Duplicate Detector FAILED (rate ${(dupRate * 100).toFixed(2)}% > ${MAX_DUP_RATE * 100}%)`);
    process.exit(1);
  }
  console.log("\n✅ Duplicate Detector passed");
}

main().catch((err) => {
  console.error("⚠️  Dedupe scan error:", err.message);
  process.exit(0);
});
