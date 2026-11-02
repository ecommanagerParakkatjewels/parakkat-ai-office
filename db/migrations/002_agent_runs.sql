-- Agent runs: one row per detector execution. This is the record the floor
-- draws from and the proof of what each agent looked at. Never one row per item.
create table office.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  agent_id      text not null,
  detector      text not null,
  trigger       text not null check (trigger in ('manual', 'schedule')),
  status        text not null default 'running' check (status in ('running', 'ok', 'failed')),
  source        text not null,
  items_scanned integer check (items_scanned >= 0),
  matched       integer check (matched >= 0),
  outcome       text check (outcome in ('filed', 'updated', 'reopened', 'clean', 'nothing_found')),
  finding_id    uuid,
  error         text,
  run_by        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  foreign key (tenant_id, agent_id) references office.agents (tenant_id, id),
  foreign key (tenant_id, finding_id) references office.findings (tenant_id, id),
  check (status <> 'failed' or error is not null),
  check (status <> 'ok' or (finished_at is not null and items_scanned is not null and matched is not null and outcome is not null))
);
create index agent_runs_recent_idx on office.agent_runs (tenant_id, started_at desc);
alter table office.agent_runs enable row level security;
