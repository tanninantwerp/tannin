-- One row per order, not one per time it left the building.
--
-- The first cut filed a record on each print and each email, so an order that
-- was printed for the trolley and mailed to the buyer appeared twice, thirty
-- seconds apart, looking like two orders. The log answers "what did we order",
-- and the answer is one order however many ways it came out.
--
-- So the order is filed once, when the buyer finalises it, and printing or
-- mailing stamps that same row. `method` is replaced by two timestamps: it
-- could only ever hold one answer, and an order is commonly both.
--
-- Finalising also fixes what the sheet says. Print and email render the stored
-- snapshot rather than the live list, so what comes out of the printer is what
-- the log says was ordered - not whatever the basket happened to contain by the
-- time somebody got to it.

alter table order_history add column if not exists printed_at timestamptz;
alter table order_history add column if not exists emailed_at timestamptz;

-- Existing records keep their meaning: the one thing they recorded becomes the
-- timestamp for that one thing.
--
-- Guarded and executed dynamically so the whole file can be applied twice. The
-- column is dropped below, and a second run would otherwise fail parsing an
-- update against a column that is no longer there.
do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_history' and column_name = 'method'
  ) then
    execute 'update order_history set printed_at = created_at where method = ''print'' and printed_at is null';
    execute 'update order_history set emailed_at = created_at where method = ''email'' and emailed_at is null';
  end if;
end $mig$;
-- Two rows that were one order stay two rows. They are a true record of what
-- happened under the old scheme, and rewriting history to match a later design
-- is exactly what this table is built not to do.
alter table order_history drop column if exists method;

comment on column order_history.printed_at is 'When the sheet was generated, null if never printed.';
comment on column order_history.emailed_at is 'When it was last mailed, null if never emailed.';
