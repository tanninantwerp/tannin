-- Repair cellar rows that were written as UTF-8 and stored as Windows-1252.
--
-- The visible symptom was "Les Longeroies â€” Marsannay" on the wine page. The
-- site now also repairs these on read (`repairEncoding` in @tannin/core, called
-- from `fetchWines`), so this migration is not what makes the page correct - it
-- is what stops the bad bytes being carried forward into exports, the printed
-- wine list and anything else that reads the table directly.
--
-- Only the sequences we have actually seen are touched. A repair table that
-- guesses is how one broken row becomes ten. Idempotent: re-running it on
-- already-correct text changes nothing.

update wines
set
  name = replace(replace(name, 'â€”', '-'), 'â€“', '-'),
  producer = replace(replace(producer, 'â€”', '-'), 'â€“', '-'),
  region = replace(replace(region, 'â€”', '-'), 'â€“', '-'),
  tasting_note = replace(replace(tasting_note, 'â€”', '-'), 'â€“', '-')
where
  name like '%â€%'
  or producer like '%â€%'
  or region like '%â€%'
  or tasting_note like '%â€%';

-- The same bottle also had its region ("Burgundy") sitting in the country
-- column, which is the data problem the wine page's country filter exists to
-- survive. The site resolves this at read time for every row
-- (`resolveWineOrigin`), so this only settles the one row we know by name
-- rather than attempting a bulk re-filing in SQL that the application already
-- does correctly and testably.
update wines
set country = 'France', region = coalesce(nullif(region, ''), 'Burgundy')
where country = 'Burgundy';
