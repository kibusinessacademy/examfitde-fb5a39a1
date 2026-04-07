
CREATE OR REPLACE VIEW v_course_display_ssot AS
WITH base AS (
    SELECT cp.id AS package_id,
        cp.course_id,
        cp.curriculum_id,
        cp.status,
        cp.build_progress,
        cp.integrity_passed,
        cp.council_approved,
        cp.council_approved_at,
        cp.published_at,
        cp.created_at,
        cp.updated_at,
        cp.components,
        cp.created_by,
        cp.priority,
        cp.title AS pkg_title,
        c.id AS course_row_id,
        c.title AS raw_course_title,
        cu.title AS raw_curriculum_title,
        b.id AS beruf_id,
        b.bezeichnung_kurz AS beruf_display_name,
        -- Use curriculum title when it's more specific than the generic beruf name
        -- This handles Fachinformatiker specializations (AE, SI, DPA, DV)
        CASE 
            WHEN b.bezeichnung_kurz IS NOT NULL 
                 AND TRIM(b.bezeichnung_kurz) <> ''
                 AND cu.title IS NOT NULL
                 AND TRIM(cu.title) <> ''
                 AND LENGTH(TRIM(cu.title)) > LENGTH(TRIM(b.bezeichnung_kurz))
                 AND TRIM(cu.title) ILIKE '%' || SPLIT_PART(TRIM(b.bezeichnung_kurz), ' ', 1) || '%'
            THEN TRIM(cu.title)
            ELSE COALESCE(
                NULLIF(TRIM(b.bezeichnung_kurz), ''),
                NULLIF(TRIM(cu.title), ''),
                NULLIF(TRIM(c.title), ''),
                cp.title
            )
        END AS initial_title
    FROM course_packages cp
        LEFT JOIN courses c ON c.id = cp.course_id
        LEFT JOIN curricula cu ON cu.id = cp.curriculum_id
        LEFT JOIN berufe b ON b.id = cu.beruf_id
    WHERE cp.status <> 'archived'
), aliased AS (
    SELECT base.*,
        COALESCE(a.canonical_title, base.initial_title) AS canonical_title
    FROM base
        LEFT JOIN course_title_aliases a ON normalize_course_title(a.alias_title) = normalize_course_title(base.initial_title)
)
SELECT package_id,
    package_id AS id,
    course_id,
    curriculum_id,
    status,
    build_progress,
    integrity_passed,
    council_approved,
    council_approved_at,
    published_at,
    created_at,
    updated_at,
    components,
    created_by,
    priority,
    course_row_id,
    raw_course_title,
    raw_curriculum_title,
    beruf_id,
    beruf_display_name,
    initial_title,
    canonical_title,
    canonical_title AS title,
    normalize_course_title(canonical_title) AS canonical_title_norm
FROM aliased;
