create table if not exists runs (
  id uuid primary key,
  player_name text not null check (char_length(player_name) between 1 and 18),
  survival_ms integer not null check (survival_ms >= 0),
  score integer not null check (score >= 0),
  kills integer not null check (kills >= 0),
  max_threat_level integer not null check (max_threat_level >= 1),
  seed text not null,
  mode text not null check (mode in ('endless', 'daily')),
  build_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists runs_mode_rank_idx
  on runs (mode, survival_ms desc, score desc, kills desc);

alter table runs enable row level security;

create policy "runs are publicly readable"
  on runs for select
  using (true);

create policy "anyone can submit a run"
  on runs for insert
  with check (
    survival_ms >= 0
    and survival_ms <= 3600000
    and score >= 0
    and score <= 10000000
    and kills >= 0
    and kills <= 100000
    and char_length(player_name) between 1 and 18
  );
