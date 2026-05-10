-- One-shot renumber of freight_quotes.id to the new FQ-NNNN mask.
--
-- Format: FQ-0001, FQ-0002, … (4-digit zero-padded).
-- Order:  date_added ASC (NULLs treated as far future so legacy rows
--         without a date sit at the end), then id ASC for stable ties.
--
-- Two-pass approach so we don't trip the freight_quotes PK while
-- swapping ids in place: park every id under a temp prefix first,
-- then assign the new sequential FQ-NNNN values.

BEGIN;

-- Pass 1: park every existing id under a unique temp prefix so the
--         next UPDATE can claim any FQ-NNNN without collision.
UPDATE freight_quotes
   SET id = '__RENUM__' || id;

-- Pass 2: assign sequential FQ-NNNN ids ordered by date_added asc.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           ORDER BY COALESCE(date_added, '9999-12-31') ASC, id ASC
         ) AS rn
    FROM freight_quotes
)
UPDATE freight_quotes fq
   SET id = 'FQ-' || lpad(ranked.rn::text, 4, '0')
  FROM ranked
 WHERE fq.id = ranked.id;

COMMIT;
