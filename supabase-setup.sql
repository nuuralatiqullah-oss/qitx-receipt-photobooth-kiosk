-- ============================================================
-- PHOTOBOOTH KIOSK — Supabase setup
-- Paste the whole file into Supabase Dashboard -> SQL Editor -> Run.
-- Safe to run more than once.
-- ============================================================

-- ---------- frames (optional: custom layouts without redeploying) ----------
create table if not exists public.frames (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  width        int  not null default 576,
  height       int  not null,
  shots        int  not null default 1,
  slots        jsonb not null,              -- [{"x":48,"y":150,"w":480,"h":360}, ...]
  overlay_path text,                        -- file in the booth-frames bucket
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- prints (one row per printed sheet) ----------
create table if not exists public.prints (
  id           uuid primary key default gen_random_uuid(),
  session_id   text,
  frame_id     text,
  storage_path text not null,
  copies       int not null default 1,
  created_at   timestamptz not null default now()
);

alter table public.frames enable row level security;
alter table public.prints enable row level security;

-- Kiosk runs as the anon role: it reads frames and writes prints, nothing else.
drop policy if exists "anon reads active frames" on public.frames;
create policy "anon reads active frames"
  on public.frames for select
  to anon
  using (active = true);

drop policy if exists "anon inserts prints" on public.prints;
create policy "anon inserts prints"
  on public.prints for insert
  to anon
  with check (true);

-- You, logged in to the dashboard, can read everything.
drop policy if exists "owner reads prints" on public.prints;
create policy "owner reads prints"
  on public.prints for select
  to authenticated
  using (true);

drop policy if exists "owner manages frames" on public.frames;
create policy "owner manages frames"
  on public.frames for all
  to authenticated
  using (true) with check (true);

-- ---------- storage buckets ----------
-- Public, because guests scan a QR and open the photo with no login.
-- Anyone with the link can view it: that is the trade-off for QR download.
insert into storage.buckets (id, name, public)
values ('booth-photos', 'booth-photos', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('booth-frames', 'booth-frames', true)
on conflict (id) do update set public = true;

-- Kiosk uploads photos as anon.
drop policy if exists "anon uploads booth photos" on storage.objects;
create policy "anon uploads booth photos"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'booth-photos');

-- Storage's upload endpoint does INSERT ... RETURNING, so the inserted row
-- must also pass a SELECT policy or the upload reports an RLS error even
-- though the INSERT itself succeeded. Public buckets already allow reads,
-- but this keeps it explicit if you ever flip the bucket to private.
drop policy if exists "anon reads booth photos" on storage.objects;
create policy "anon reads booth photos"
  on storage.objects for select
  to anon
  using (bucket_id in ('booth-photos', 'booth-frames'));
