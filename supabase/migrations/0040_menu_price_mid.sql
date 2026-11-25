-- A middle price tier for the food menu.
--
-- The Ibérico cold cuts come in three plate sizes — 11 / 16 / 19 — but the menu
-- only stored two prices (price, price_max). This adds an optional middle tier
-- so a dish can list three. Nullable; almost every dish uses none or one.

alter table menu_items add column if not exists price_mid numeric(6,2);
