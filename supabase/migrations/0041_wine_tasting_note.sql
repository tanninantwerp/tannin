-- A tasting note for a wine.
--
-- The cellar list carries facts — producer, region, grapes, vintage — but no
-- room to say how a bottle actually tastes. This adds a free-text note the
-- staff can write and the website shows, so a wine can be explained by taste.

alter table wines add column if not exists tasting_note text;
