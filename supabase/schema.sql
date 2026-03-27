create table if not exists public.users_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  uploaded_file_name text not null,
  total_subscription_spend numeric not null default 0,
  subscriptions_detected jsonb not null default '[]'::jsonb,
  savings_amount numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.users_data enable row level security;

create policy "users can read own data"
on public.users_data
for select
to authenticated
using (auth.uid() = user_id);

create policy "users can insert own data"
on public.users_data
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users can update own data"
on public.users_data
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
