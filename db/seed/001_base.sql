-- Base data every deployment needs. Safe to re-run.
insert into office.tenants (slug, name)
values ('jewels', 'Parakkat Jewels')
on conflict (slug) do nothing;

-- The ten agents and their seats on the floor (tile coordinates).
insert into office.agents (tenant_id, id, name, zone, seat_x, seat_y)
select t.id, a.id, a.name, a.zone, a.x, a.y
from office.tenants t
cross join (values
  ('triage',          'Triage',            'intake',       2.0, 1.5),
  ('reviewer',        'Reviewer',          'review',       8.0, 1.5),
  ('digest',          'Digest',            'review',      11.0, 1.5),
  ('catalogue',       'Catalogue',         'specialists',  2.0, 4.5),
  ('seo_content',     'SEO & content',     'specialists',  5.0, 4.5),
  ('pricing_offers',  'Pricing & offers',  'specialists',  8.0, 4.5),
  ('site_tech',       'Site & technical',  'specialists', 11.0, 4.5),
  ('shipping_rto',    'Shipping & RTO',    'specialists',  2.0, 7.5),
  ('checkout_carts',  'Checkout & carts',  'specialists',  5.0, 7.5),
  ('marketing_spend', 'Marketing spend',   'specialists',  8.0, 7.5)
) as a(id, name, zone, x, y)
where t.slug = 'jewels'
on conflict (tenant_id, id) do nothing;

-- Owners are deliberately NOT seeded: real names are NOT PROVIDED (open item s7).
-- Add them in the app or with:
--   insert into office.owners (tenant_id, name, kind)
--   select id, 'Store team', 'team' from office.tenants where slug = 'jewels';
