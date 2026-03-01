-- 1) Referrals table and points trigger
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null,
  referred_user_id uuid not null unique,
  created_at timestamptz not null default now(),
  points_awarded boolean not null default false
);

alter table public.referrals enable row level security;

-- RLS: insert only by the referred user (prevents others from minting referrals on their behalf)
create policy "Users can insert their own referral record"
  on public.referrals
  for insert
  to authenticated
  with check (auth.uid() = referred_user_id);

-- RLS: users can view referrals they are involved in
create policy "Users can view their own referrals"
  on public.referrals
  for select
  to authenticated
  using (
    auth.uid() = referrer_id or auth.uid() = referred_user_id
  );

-- Prevent self-referrals at DB level via a trigger (so client can't bypass)
create or replace function public.award_referral_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.referrer_id = new.referred_user_id then
    raise exception 'Cannot refer yourself';
  end if;

  -- Award 50 points to referrer exactly once per referred user
  if not new.points_awarded then
    update public.profiles
      set points = coalesce(points, 0) + 50,
          updated_at = now()
      where id = new.referrer_id;

    new.points_awarded = true;
  end if;

  return new;
end;
$$;

-- Use BEFORE INSERT so we can set points_awarded = true atomically
create trigger trg_award_referral_points
before insert on public.referrals
for each row
execute function public.award_referral_points();

-- 2) Realtime: ensure tables are configured
alter table public.recordings replica identity full;
alter table public.tasks replica identity full;
alter table public.languages replica identity full;
alter table public.profiles replica identity full;

-- Add tables to realtime publication (idempotent: ignore if already added)
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recordings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.languages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;