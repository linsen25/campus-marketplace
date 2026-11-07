-- Deterministic rollback-only source listing for the shared delivery fixture.
-- This file is inserted between the fixture definitions and its immediate
-- regression DO block so bc_accept never depends on pre-existing rows.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}', true);
  insert into public.listings(
    seller_id,title,description,price_cents,currency,category,subcategory,
    condition,pickup_area,expected_image_count,published_at
  ) values (
    (select seller from bc_people),'B31 source listing',
    'Synthetic published source for rollback-only runtime tests',10000,'CAD',
    'Electronics','Computers & Tablets','good','Western University',1,clock_timestamp()
  );
  if not exists(select 1 from public.listings where title='B31 source listing' and published_at is not null and status='available') then
    raise exception 'B31 deterministic published listing fixture missing';
  end if;
end $$;
