-- Instagram provenance for events.
--
-- Events curated from @tannin_antwerp / @cellar_antwerp can link back to the
-- post they came from, and record which account it was so the public card can
-- read "Seen on @…". Both columns are nullable and additive — every existing
-- event is untouched, and an event with no source simply shows no link.

alter table events
  add column if not exists source_url text,
  add column if not exists source_account text
    check (source_account in ('tannin', 'cellar'));
