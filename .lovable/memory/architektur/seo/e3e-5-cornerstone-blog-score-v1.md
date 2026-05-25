---
name: e3e-5-cornerstone-blog-score-v1
description: Cornerstone-Score ersetzt naive Wortzahl-Proxy für pillar_to_cornerstone_blog; Pilot bleibt Human-Gate
type: feature
---

# E3e.5 — Cornerstone Blog Score v1 (2026-05-25)

## Was sich geändert hat
- **SSOT `v_seo_bridge_candidates_v1`** `ptcb`-Arm: `similarity_score` ist jetzt ein composite **cornerstone_score** statt `word_count/2000`-Proxy.
- Neuer diagnostischer View **`v_cornerstone_blog_score`** (per-Blog Komponenten + Composite, locked auf service_role).
- Neue Admin-RPC **`admin_get_cornerstone_blog_score_summary()`** (has_role-Gate).
- Registry/Governance-Notes für `pillar_to_cornerstone_blog` auf E3e.5 aktualisiert.
- Audit-Contract **`cornerstone_blog_score_v1_deployed`** registriert.

## Formel (Cap 0..1)
| Komponente | Gewicht | Datenquelle |
|---|---|---|
| `s_depth` | 0.25 | `word_count / 1800` |
| `s_faq` | 0.15 | `jsonb_array_length(faq_json) / 6` |
| `s_quality` | 0.10 | `content_quality_signals != {}` |
| `s_hero` | 0.10 | `hero_image_url IS NOT NULL` |
| `s_anchor` | 0.10 | `competency_id IS NOT NULL` |
| `s_winner` | 0.10 | `is_winner` |
| `s_views` | 0.10 | `total_views / 500` |
| `s_perf` | 0.10 | `performance_score` (0..1) |

## Baseline 2026-05-25
| Metrik | Wert |
|---|---|
| total_published_blogs | 256 |
| avg_cornerstone_score | 0.174 |
| p75 / p90 | 0.220 / 0.344 |
| eligible_above_0.60 (min_sim) | **0** |
| eligible_above_0.70 | 0 |
| ptcb_ready (vor) | 2 (Phantom unter naivem Proxy) |
| ptcb_ready (nach) | **0** (ehrliches Gating) |
| ptcb_blocked_min_sim | 143 |
| Top-Score | 0.4011 (`rahmenlehrplan-elektroniker-...`) |

## Pilot bleibt OFF (Human-Gate)
`pilot_active=false`. Aktivierung erst nach einer dieser drei Bedingungen:
1. Performance-Signale (CTR/dwell/`performance_score`/`total_views`) gefüllt — heben `s_perf+s_views` an.
2. Content-Enrichment (FAQ-Cards, Hero-Image, `content_quality_signals`) auf Top-30 Kandidaten.
3. Bewusste Senkung `min_semantic_similarity` von 0.60 auf z.B. 0.40 (würde ~10-30 Kandidaten freischalten — Quality-Trade-off).

## Aktivierungs-Pfad (wenn ready)
```sql
-- Dry-Run
SELECT public.admin_seo_bridge_pilot_generate('pillar_to_cornerstone_blog', true);
-- Live: pilot_active true + cap setzen, dann dry_run=false
UPDATE public.seo_bridge_type_registry SET pilot_active=true, pilot_cap=20, pilot_started_at=now()
 WHERE link_type='pillar_to_cornerstone_blog';
SELECT public.admin_seo_bridge_pilot_generate('pillar_to_cornerstone_blog', false);
```

## Smoke
- View source enthält neue Score-Formel: ✅
- RPC ausführbar mit has_role-Gate: ✅
- Deployment-Audit `cornerstone_blog_score_v1_deployed` v1: ✅
