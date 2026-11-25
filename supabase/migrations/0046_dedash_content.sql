-- Replace em dashes (-) with hyphens (-) across website-facing content, so the
-- live menu, wine list, bar list and events read with plain hyphens instead of
-- em dashes. Idempotent and safe to re-run.
--
-- Left untouched on purpose: dining_tables.name (internal floor-plan labels the
-- app and its tests match by exact string) and social_posts (mirrored from
-- Instagram, overwritten on the next sync).

update menu_sections set title = replace(title, '—', '-') where title like '%—%';

update menu_items
  set name = replace(name, '—', '-'),
      note = replace(note, '—', '-')
  where name like '%—%' or note like '%—%';

update drink_sections set title = replace(title, '—', '-') where title like '%—%';

update drinks
  set name = replace(name, '—', '-'),
      note = replace(note, '—', '-')
  where name like '%—%' or note like '%—%';

update wines
  set name = replace(name, '—', '-'),
      producer = replace(producer, '—', '-'),
      country = replace(country, '—', '-'),
      region = replace(region, '—', '-'),
      tasting_note = replace(tasting_note, '—', '-')
  where name like '%—%' or producer like '%—%' or country like '%—%'
     or region like '%—%' or tasting_note like '%—%';

update events
  set title = replace(title, '—', '-'),
      location = replace(location, '—', '-'),
      summary = replace(summary, '—', '-'),
      body = replace(body, '—', '-')
  where title like '%—%' or location like '%—%' or summary like '%—%' or body like '%—%';
