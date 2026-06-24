-- Adds camera-direction (compass heading) support to submissions and submission_revisions.
-- direction: integer 0-359, NULL = not recorded.

ALTER TABLE public.submissions
    ADD COLUMN IF NOT EXISTS direction integer,
    ADD CONSTRAINT submissions_direction_check
        CHECK (direction IS NULL OR (direction >= 0 AND direction <= 359));

ALTER TABLE public.submission_revisions
    ADD COLUMN IF NOT EXISTS direction integer,
    ADD CONSTRAINT submission_revisions_direction_check
        CHECK (direction IS NULL OR (direction >= 0 AND direction <= 359));
