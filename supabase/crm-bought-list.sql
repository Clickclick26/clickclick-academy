-- The CRM list every paying Academy buyer is added to, so they can be found
-- and upsold later. academy-stripe looks it up by this exact name.
insert into public.dialer_lists (name, emoji, sort_order)
select 'Bought a course', '💰', 0
where not exists (select 1 from public.dialer_lists where name = 'Bought a course');
