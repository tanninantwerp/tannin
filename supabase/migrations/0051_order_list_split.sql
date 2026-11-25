-- Three lists, not one basket.
--
-- The first cut shared a single shopping list across wines, drinks and food and
-- grouped it under headings. That is one shopping trip, which is not how this
-- bar buys: the cellar, the bar and the kitchen are ordered separately, by
-- different people, on different days. So each tab now keeps its own list, and
-- prints and mails its own sheet.
--
-- No change to `order_list_items` itself - a line already belongs to a category
-- through the product it points at, so "the food list" is simply the lines whose
-- product is food. Adding a category column here would be a second, copyable
-- answer to a question the data already answers once.
--
-- `order_history` does need it. A filed list is a snapshot with no live link
-- back to the catalogue, so without this it could not say which of the three it
-- was - and "Food, Tuesday 14:20" is most of what makes the record findable.

alter table order_history add column if not exists category text
  check (category is null or category in ('wine', 'drink', 'food'));

comment on column order_history.category is
  'Which of the three lists this was. Null only for records filed before the lists were split.';
