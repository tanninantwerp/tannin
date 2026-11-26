-- Off the menu, not deleted.
--
-- The food menu, the bar list and the wine list change with the season, and
-- dishes and bottles come back. Deleting a row loses its notes, grapes and
-- position; marking it sold out keeps it on the website (greyed out). This
-- flag hides a row from the website and the printed menus while the admin
-- keeps it, with a button to put it back.

alter table menu_items add column if not exists on_menu boolean not null default true;
alter table drinks     add column if not exists on_menu boolean not null default true;
alter table wines      add column if not exists on_menu boolean not null default true;
