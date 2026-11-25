-- The buyer's catalogue and shopping list.
--
-- Two tables, because what you buy and what you sell are different lists. A
-- dish uses many products and a product serves many dishes, so deriving the
-- order list from the menus would break the first time somebody buys ice, cling
-- film or coffee filters - none of which are on a menu.
--
--   order_items       the catalogue: everything the bar and kitchen can buy
--   order_list_items  the current shopping list: catalogue row + a quantity
--
-- `verified` is the honest part. Wines and bar stock are seeded from rows the
-- venue already maintains, so they are true by construction. Food ingredients
-- and cocktail components are NOT recorded anywhere in this database - the menu
-- stores a dish name and a garnish note, never a recipe - so they are seeded
-- from standard recipes for those dishes and marked unverified. They are a
-- starting point for the kitchen to correct, not a claim about how Ta-nnin
-- actually cooks, and the admin marks them as such until somebody confirms one.

-- Who you buy it from. A managed list rather than free text on each product:
-- an order is placed per supplier, so "Horeca Totaal" and "horeca totaal"
-- being two different answers would quietly split one order into two.
create table if not exists order_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  note       text,
  position   integer not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table order_suppliers enable row level security;

drop policy if exists "order_suppliers staff" on order_suppliers;
create policy "order_suppliers staff" on order_suppliers
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

-- Only three names are known so far, and the rest get added as staff learn
-- them, so this is seeded thin on purpose rather than guessed at.
insert into order_suppliers (name, note, position) values
  ('Horeca Totaal', 'general wholesale', 1),
  ('Van Tricht', 'cheese', 2),
  ('De Laet & Van Haver', 'meat', 3)
on conflict (name) do nothing;

create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('wine', 'drink', 'food')),
  name       text not null,
  -- What you order it by: bottle, kg, crate. Without this a list of bare
  -- numbers is ambiguous at the counter.
  unit       text,
  -- Supplier, size, or whatever the buyer needs to see. Free text on purpose.
  note       text,
  position   integer not null default 0,
  verified   boolean not null default false,
  archived   boolean not null default false,
  -- Null until somebody knows. set null on delete, so removing a supplier
  -- unassigns its products rather than deleting things you still buy.
  supplier_id uuid references order_suppliers (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_items_category_idx on order_items (category, position);

create table if not exists order_list_items (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items (id) on delete cascade,
  quantity      numeric not null default 1 check (quantity > 0),
  -- On the list but not on this trip. Unticking is not the same as removing:
  -- the buyer keeps the line and its quantity for next week, and only the
  -- ticked rows reach the printout and the email.
  checked       boolean not null default true,
  added_at      timestamptz not null default now(),
  -- One line per product; adding it twice raises the quantity instead.
  unique (order_item_id)
);

alter table order_items enable row level security;
alter table order_list_items enable row level security;

-- Kitchen staff hold 'menu', bar staff hold 'drinks', and both do the buying.
-- Deliberately not a new permission: adding one would mean re-granting rights
-- to every existing staff member before anybody could open the page.
drop policy if exists "order_items staff" on order_items;
create policy "order_items staff" on order_items
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

drop policy if exists "order_list_items staff" on order_list_items;
create policy "order_list_items staff" on order_list_items
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

-- The buyer's email, remembered between orders. app_settings is otherwise
-- marketing-only, so this widens it to exactly one key rather than the table -
-- the Instagram access token lives in here too.
drop policy if exists "app_settings order email" on app_settings;
create policy "app_settings order email" on app_settings
  for all using (key = 'order_email' and (has_perm('menu') or has_perm('drinks')))
  with check (key = 'order_email' and (has_perm('menu') or has_perm('drinks')));

-- ── Wines ────────────────────────────────────────────────────────────────────
-- Straight from the cellar, so the catalogue starts complete and stays true to
-- the list the site prints. Verified: these are the venue's own rows.
insert into order_items (category, name, unit, note, position, verified)
select
  'wine',
  w.producer || case when w.name is not null and w.name <> w.producer then ' - ' || w.name else '' end,
  'bottle',
  nullif(concat_ws(' · ', w.vintage::text, nullif(w.region, ''), nullif(w.country, '')), ''),
  row_number() over (order by w.colour, w.position),
  true
from wines w
where not exists (select 1 from order_items o where o.category = 'wine');

-- ── Bar stock ────────────────────────────────────────────────────────────────
-- The beers, spirits, softs and mixers the bar actually buys. Wine by the glass
-- is left out: those bottles are already in the cellar list above.
insert into order_items (category, name, unit, note, position, verified)
select 'drink', name, unit, note, 1000 + row_number() over (), true
from (values
  ('IJwit', 'crate', 'Amsterdam brewery'),
  ('Tank 7', 'crate', null),
  ('Duvel', 'crate', null),
  ('Tripel d''Anvers', 'crate', null),
  ('Bavik Super Pils', 'crate', null),
  ('Duchesse de Bourgogne', 'crate', 'West-Flemish red brown ale'),
  ('Tipsy Silver', 'crate', '0% alcohol-free blond'),
  ('Unplugged - ''t Verzet', 'crate', '0% alcohol-free hazy IPA'),
  ('The Perfect Bulldog gin', 'bottle', null),
  ('Marula Pomegranate gin', 'bottle', null),
  ('Gin Mare', 'bottle', null),
  ('Copperhead gin', 'bottle', null),
  ('Copperhead 0.0 gin', 'bottle', 'alcohol-free'),
  ('Antverpia gin', 'bottle', null),
  ('Andresen 10 Year Old White Port', 'bottle', null),
  ('Amaretto', 'bottle', null),
  ('Limoncello', 'bottle', null),
  ('Maderista - Madeira Reserva Dry', 'bottle', null),
  ('Dr. Loosen Riesling Kabinett', 'bottle', 'Mosel, Germany'),
  ('Belvedere Vodka', 'bottle', null),
  ('Mezcal Del Maguey Vida', 'bottle', null),
  ('Talisker 10Y', 'bottle', null),
  ('Wild Turkey 101', 'bottle', null),
  ('Bushmills', 'bottle', null),
  ('Campari', 'bottle', null),
  ('Aperol', 'bottle', null),
  ('Crodino N.A.', 'crate', 'alcohol-free aperitif'),
  ('Chaudfontaine still 250ml', 'crate', null),
  ('Chaudfontaine sparkling 250ml', 'crate', null),
  ('Chaudfontaine still 500ml', 'crate', null),
  ('Chaudfontaine sparkling 500ml', 'crate', null),
  ('Coca-Cola', 'crate', null),
  ('Coca-Cola Zero', 'crate', null),
  ('Sprite', 'crate', null),
  ('Ice tea', 'crate', null),
  ('Fever-Tree Mediterranean tonic', 'crate', null),
  ('Fever-Tree ginger beer', 'crate', null),
  ('JARR ginger kombucha', 'crate', null)
) as t(name, unit, note)
where not exists (select 1 from order_items o where o.category = 'drink');

-- Cocktail components. Unverified: the bar list names eleven cocktails and
-- records a recipe for only some of them, so these come from the standard build
-- of each drink rather than from Ta-nnin's own spec.
insert into order_items (category, name, unit, note, position, verified)
select 'drink', name, unit, note, 2000 + row_number() over (), false
from (values
  ('Sweet vermouth', 'bottle', 'Negroni'),
  ('Prosecco / sparkling wine for spritz', 'bottle', 'Aperol & Campari Spritz'),
  ('Soda water', 'crate', 'spritz, skinny list'),
  ('Dark rum', 'bottle', 'Dark & Stormy'),
  ('0% rum', 'bottle', 'Sober Dark & Stormy'),
  ('Vanilla vodka', 'bottle', 'Porn Star Martini'),
  ('Coffee liqueur', 'bottle', 'Espresso Martini'),
  ('Espresso beans', 'kg', 'Espresso Martini'),
  ('Grilled pineapple tequila', 'bottle', 'Lilo Negroni'),
  ('Amaro Montenegro', 'bottle', 'Lilo Negroni'),
  ('Mandarinetto', 'bottle', 'Lilo Mai Tai'),
  ('Verveine brut syrup', 'bottle', 'Verveine Sparkler'),
  ('Violet syrup', 'bottle', 'Lazy Red Cheeks'),
  ('Cane sugar syrup', 'bottle', 'Lazy Red Cheeks'),
  ('Passion fruit', 'kg', 'Porn Star Martini'),
  ('Raspberries', 'punnet', 'Lazy Red Cheeks'),
  ('Limes', 'kg', 'mule, stormy, laab, skinny list'),
  ('Lemons', 'kg', 'Mai Tai, tagliolini, posset'),
  ('Oranges', 'kg', 'spritz garnish'),
  ('Blood orange', 'kg', 'Paloma'),
  ('Grapefruit', 'kg', 'Paloma'),
  ('Fresh ginger', 'kg', 'Spicy Mule'),
  ('Fresh mint', 'bunch', 'garnish'),
  ('Red chilli', 'kg', 'Paloma, Spicy Mule'),
  ('Ice', 'bag', null)
) as t(name, unit, note)
where not exists (select 1 from order_items o where o.category = 'drink' and o.verified = false);

-- ── Food ─────────────────────────────────────────────────────────────────────
-- Every one of these is unverified. The menu records a dish name and a garnish
-- note - "Steak tartare / Egg yolk" - never a recipe, so this list is the
-- standard build of each dish on the card. It is meant to be edited down and
-- corrected by whoever actually cooks it.
insert into order_items (category, name, unit, note, position, verified)
select 'food', name, unit, note, row_number() over (), false
from (values
  -- Small bites
  ('Smoked almonds', 'kg', 'Salt pepper & smoked almonds'),
  ('Gordal olives', 'kg', 'from Priorat, Spain'),
  ('Sourdough bread', 'loaf', 'Bread & butter, focaccia service'),
  ('Butter', 'kg', 'Bread & butter'),
  ('White miso', 'kg', 'Caramelized onion miso'),
  ('Onions', 'kg', 'miso butter, pickles'),
  ('Chickpeas', 'kg', 'Hummus tandoori'),
  ('Tahini', 'kg', 'Hummus tandoori'),
  ('Tandoori spice', 'kg', 'Hummus tandoori'),
  ('Papadums', 'box', 'Hummus tandoori'),
  ('Padrón peppers', 'kg', 'Pimientos de Padrón'),
  ('Sea salt flakes', 'kg', 'Padrón, seasoning'),
  ('Olive oil', 'litre', 'throughout'),
  -- Ta-nnin classics
  ('Chicken thigh', 'kg', 'Japanese crispy chicken'),
  ('Potato starch', 'kg', 'crispy chicken coating'),
  ('Sriracha', 'bottle', 'yellow sriracha dressing'),
  ('Mayonnaise', 'kg', 'dressings, fries'),
  ('Beef mince', 'kg', 'Korean beef gyoza'),
  ('Gyoza wrappers', 'pack', 'Korean beef gyoza'),
  ('Okonomiyaki sauce', 'bottle', 'Korean beef gyoza'),
  ('Bonito flakes', 'pack', 'gyoza garnish'),
  ('Herve cheese', 'kg', 'Cheese croquette'),
  ('Parmesan', 'kg', 'croquette, sweet potato fries, tagliolini'),
  ('Breadcrumbs', 'kg', 'croquettes'),
  ('Eggs', 'tray', 'croquettes, tartare, tanninmisu'),
  ('Plain flour', 'kg', 'croquettes, crumble'),
  ('Pulled pork', 'kg', 'Ta-nnin croquette'),
  -- Cheese & cuts
  ('Cheese selection', 'kg', 'Van Tricht - platter & afterhours'),
  ('Charcuterie selection', 'kg', 'Cold cut & mixed platter'),
  ('Ibérico ham', 'kg', 'Ibérico cold cuts'),
  ('Secreto pork', 'kg', 'De Laet & Van Haver, 100gr portions'),
  ('Ibérico pluma', 'kg', 'Ibérico pluma ± 350gr'),
  ('Salame', 'kg', 'Salame market - afterhours'),
  ('Sardines tinned', 'tin', 'Sardinha - afterhours'),
  ('Crackers', 'box', 'served with the afterhours plates'),
  -- Tasty starters
  ('Duck breast', 'kg', 'Crispy duck salad'),
  ('Mixed salad leaves', 'kg', 'salads'),
  ('Sesame seeds', 'kg', 'sesame dressing'),
  ('Sesame oil', 'litre', 'sesame dressing, burnt tuna'),
  ('Mie noodles', 'pack', 'crispy mie'),
  ('Tuna loin', 'kg', 'Burnt tuna'),
  ('Ponzu', 'bottle', 'Burnt tuna'),
  ('Furikake', 'pack', 'Burnt tuna'),
  ('Avocado', 'piece', 'Burnt tuna, Saveur d''antan'),
  ('Beef tenderloin', 'kg', 'Steak tartare'),
  ('Capers', 'jar', 'Steak tartare'),
  ('Shallots', 'kg', 'tartare, pickled shallot'),
  ('Dijon mustard', 'jar', 'tartare, vinaigrette, chicory'),
  ('Cornichons', 'jar', 'Steak tartare'),
  ('Worcestershire sauce', 'bottle', 'Steak tartare'),
  ('Tabasco', 'bottle', 'Steak tartare'),
  ('Artichokes', 'kg', 'Artichoke flower'),
  ('Focaccia', 'piece', 'Focaccia mortadella'),
  ('Mortadella', 'kg', 'Focaccia mortadella'),
  ('Pistachios', 'kg', 'pistachio pesto'),
  ('Basil', 'bunch', 'pesto, tagliolini, Saveur d''antan'),
  ('Stracciatella', 'kg', 'Focaccia mortadella'),
  -- Salads
  ('Tomatoes Saveur d''antan', 'kg', 'Saveur d''antan'),
  ('Chicory', 'kg', 'Chicory salad'),
  ('Apples', 'kg', 'Chicory salad'),
  ('Crispy lettuce', 'piece', 'Crispy lettuce'),
  ('Chives', 'bunch', 'Crispy lettuce'),
  ('White wine vinegar', 'litre', 'pickling, vinaigrette'),
  -- From land & sea
  ('Entrecôte', 'kg', 'Tagliata carima ± 300gr'),
  ('Flat parsley', 'bunch', 'chimichurri, gambas'),
  ('Dried oregano', 'pack', 'chimichurri'),
  ('Red wine vinegar', 'litre', 'chimichurri'),
  ('Garlic', 'kg', 'throughout'),
  ('Gambas', 'kg', 'Gamba''s à la plancha'),
  ('Salmon fillet', 'kg', 'Spicy salmon'),
  ('Fish sauce', 'bottle', 'Thai laab'),
  ('Coriander', 'bunch', 'laab, mussels'),
  ('Mussels', 'kg', 'Steamed mussels'),
  ('Lemongrass', 'kg', 'Thai style mussels'),
  ('Galangal', 'kg', 'Thai style mussels'),
  ('Coconut milk', 'tin', 'Thai style mussels'),
  ('Kaffir lime leaves', 'pack', 'Thai style mussels'),
  ('Belgian pickles', 'jar', 'Ibérico pluma'),
  ('Tagliolini', 'kg', 'Tagliolini al limone'),
  ('Cream', 'litre', 'tagliolini, lemon posset'),
  -- Sides
  ('Potatoes for frying', 'kg', 'Potato fries'),
  ('Sweet potatoes', 'kg', 'Sweet potato fries'),
  ('Frying oil', 'litre', 'fries, croquettes'),
  ('Mustard seeds', 'jar', 'homemade mayo'),
  ('Truffle mayonnaise', 'kg', 'Sweet potato fries'),
  -- Sweet
  ('Mascarpone', 'kg', 'Tanninmisu'),
  ('Savoiardi biscuits', 'pack', 'Tanninmisu'),
  ('Cocoa powder', 'kg', 'Tanninmisu'),
  ('Marsala', 'bottle', 'Tanninmisu'),
  ('Caster sugar', 'kg', 'posset, crumble'),
  ('Pineapple', 'piece', 'Lemon posset')
) as t(name, unit, note)
where not exists (select 1 from order_items o where o.category = 'food');

-- The only supplier links the existing data actually supports: the menu names
-- Van Tricht on the cheese and De Laet & Van Haver on the Secreto. Everything
-- else stays unassigned rather than guessed.
update order_items set supplier_id = (select id from order_suppliers where name = 'Van Tricht')
where category = 'food' and name = 'Cheese selection';

update order_items set supplier_id = (select id from order_suppliers where name = 'De Laet & Van Haver')
where category = 'food' and name in ('Secreto pork', 'Ibérico pluma', 'Ibérico ham');
