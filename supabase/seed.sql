-- seed.sql — Muneeb Ghazi Services: the 9 TikTok "For You" services
-- Idempotent: seeded rows are deleted by title first, then re-inserted.
-- Money is in integer PAISA (Rs 245 = 24500). Run after 0001_init.sql.

delete from public.services
where title in (
  'Video on For You — 1,200 Views',
  'Video on For You — 2,500 Views',
  'Video on For You — 5,500 Views',
  'Video on For You — 12,000 Views',
  '65–195 Followers + Likes & Views',
  '105–395 Followers + Likes & Views',
  '205–795 Followers + Likes & Views',
  '1k Followers — Our Video',
  '1k Followers — Your Own Video'
);

insert into public.services
  (platform, category, title, description, price_paisa, unit, min_qty, active, sort_order)
values
  ('TikTok', 'For Likes and Views', 'Video on For You — 1,200 Views',
   'Expected Response:
✔ 1,000–2,000 Views
✔ 400–600 Likes
Maybe: Followers, Saves, Shares, Reposts, Comments',
   24500, 'package', 1, true, 1),

  ('TikTok', 'For Likes and Views', 'Video on For You — 2,500 Views',
   'Expected Response:
✔ 2,500–5,000 Views
✔ 1,000–2,500 Likes
Maybe: Followers, Saves, Shares, Reposts, Comments',
   49000, 'package', 1, true, 2),

  ('TikTok', 'For Likes and Views', 'Video on For You — 5,500 Views',
   'Expected Response:
✔ 5,500–8,000 Views
✔ 2,000–4,000 Likes
Maybe: Followers, Saves, Shares, Reposts, Comments',
   99000, 'package', 1, true, 3),

  ('TikTok', 'For Likes and Views', 'Video on For You — 12,000 Views',
   'Expected Response:
✔ 12,000–20,000 Views
✔ 4,000–8,000 Likes
Maybe: Followers, Saves, Shares, Reposts, Comments',
   190000, 'package', 1, true, 4),

  ('TikTok', 'For Followers', '65–195 Followers + Likes & Views',
   'Expected Response:
✔ 65–195 Followers
✔ Some Likes and Views
Maybe: Saves, Shares, Reposts, Comments',
   49000, 'package', 1, true, 5),

  ('TikTok', 'For Followers', '105–395 Followers + Likes & Views',
   'Expected Response:
✔ 105–395 Followers
✔ Some Likes and Views
Maybe: Saves, Shares, Reposts, Comments',
   99000, 'package', 1, true, 6),

  ('TikTok', 'For Followers', '205–795 Followers + Likes & Views',
   'Expected Response:
✔ 205–795 Followers
✔ Some Likes and Views
Maybe: Saves, Shares, Reposts, Comments',
   190000, 'package', 1, true, 7),

  ('TikTok', '1k Followers Deals', '1k Followers — Our Video',
   'Expected Response:
✔ 1,000 Followers
✔ Our video
Maybe: Likes, Views, Saves, Shares, Reposts, Comments',
   320000, 'package', 1, true, 8),

  ('TikTok', '1k Followers Deals', '1k Followers — Your Own Video',
   'Expected Response:
✔ 1,000 Followers
✔ Your own video
Maybe: Likes, Views, Saves, Shares, Reposts, Comments',
   470000, 'package', 1, true, 9);
