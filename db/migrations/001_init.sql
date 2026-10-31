-- Parakkat AI Office — schema v1
-- The rules that matter are enforced HERE, in the database, so no code path
-- (a bug, a script, a future second app) can bypass them:
--   * a finding can only reach `closed` with a clean check run recorded after
--     the owner's fix report, and a prevention rule in force
--   * one finding per defect class: (tenant, fingerprint) is unique
--   * every row belongs to a tenant, and cross-tenant references are impossible
--   * the audit log is append-only
-- Tables live in a private schema `office`, which Supabase does not expose to
-- the browser API. The app's server reaches them through DATABASE_URL only.

create schema if not exists office;

-- ---------------------------------------------------------------- types
create type office.severity as enum ('S1', 'S2', 'S3', 'S4');
create type office.area as enum (
  'catalogue', 'seo_content', 'pricing_offers', 'shipping_rto',
  'checkout_carts', 'marketing_spend', 'site_tech'
);
create type office.finding_status as enum (
  'new', 'triaged', 'assigned', 'fix_reported', 'verifying',
  'closed', 'accepted', 'recurred'
);
create type office.source_kind as enum ('manual', 'import', 'detector');

-- ---------------------------------------------------------------- tenants
create table office.tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name            text not null,
  next_finding_no integer not null default 1,
  created_at      timestamptz not null default now()
);

-- Supabase auth user -> tenant. One row today; roles arrive with user two.
create table office.members (
  user_id    uuid not null,
  tenant_id  uuid not null references office.tenants (id),
  role       text not null default 'owner' check (role in ('owner', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- People or teams on the business side who apply fixes. They do not log in.
create table office.owners (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references office.tenants (id),
  name       text not null check (length(trim(name)) between 2 and 80),
  kind       text not null default 'team' check (kind in ('team', 'person')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------- findings
create table office.findings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references office.tenants (id),
  ref              text not null,
  title            text not null check (length(trim(title)) between 5 and 200),
  area             office.area,
  severity         office.severity,
  status           office.finding_status not null default 'new',
  source           office.source_kind not null,
  source_ref       text,
  -- identity of the defect class: tenant + area + rule + target.
  -- A repeat scan updates the existing row instead of filing a new one.
  fingerprint      text not null check (length(fingerprint) between 3 and 200),
  scope_count      integer check (scope_count >= 0),
  scope_unit       text,
  scope_counted_at date,
  money_at_risk_inr numeric(14, 2),
  money_method     text,
  root_cause       text,
  proposed_fix     text,
  owner_id         uuid,
  assigned_at      timestamptz,
  due_on           date,
  fix_reported_at  timestamptz,
  closed_at        timestamptz,
  accepted_reason  text,
  recurrence_count integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, ref),
  unique (tenant_id, fingerprint),
  unique (tenant_id, id),
  foreign key (tenant_id, owner_id) references office.owners (tenant_id, id),
  -- a count without the date it was counted is worthless
  check (scope_count is null or scope_counted_at is not null),
  -- never an unmarked estimate
  check (money_at_risk_inr is null or money_method is not null)
);
create index findings_open_idx on office.findings (tenant_id, status, severity);

-- ---------------------------------------------------------------- evidence
-- Files go to object storage; the row holds a path and a hash, never bytes.
create table office.evidence (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  finding_id   uuid not null,
  kind         text not null check (kind in ('text', 'url', 'query', 'file', 'record')),
  body         text,
  url          text,
  storage_path text,
  sha256       text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  source       text not null,
  read_at      timestamptz not null,
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, finding_id) references office.findings (tenant_id, id) on delete cascade,
  check (body is not null or url is not null or storage_path is not null),
  check (storage_path is null or sha256 is not null)
);

-- ---------------------------------------------------------------- checks
-- A saved, re-runnable verification: the same thing that found the defect.
create table office.checks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  finding_id  uuid not null,
  name        text not null,
  description text not null,
  kind        text not null check (kind in ('manual', 'query', 'detector')),
  definition  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, finding_id) references office.findings (tenant_id, id) on delete cascade
);

-- One row per execution — never one row per matched item.
-- Fastest-growing table; detail kept 90 days then rolled up (Day 6).
create table office.check_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  check_id      uuid not null,
  ran_at        timestamptz not null default now(),
  matched_count integer not null check (matched_count >= 0),
  sample        jsonb not null default '[]'::jsonb
                check (jsonb_typeof(sample) = 'array' and jsonb_array_length(sample) <= 20),
  result        text not null check (result in ('clean', 'still_matching', 'error')),
  note          text,
  run_by        text not null,
  foreign key (tenant_id, check_id) references office.checks (tenant_id, id) on delete cascade,
  check (result <> 'clean' or matched_count = 0)
);
create index check_runs_check_idx on office.check_runs (check_id, ran_at desc);

-- ---------------------------------------------------------------- prevention rules
create table office.prevention_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  finding_id  uuid not null,
  rule        text not null check (length(trim(rule)) >= 10),
  status      text not null default 'proposed' check (status in ('proposed', 'in_force', 'failed')),
  proposed_by text not null check (proposed_by in ('human', 'claude')),
  accepted_at timestamptz,
  failed_at   timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, finding_id) references office.findings (tenant_id, id) on delete cascade,
  check (status <> 'in_force' or accepted_at is not null),
  check (status <> 'failed' or failed_at is not null)
);

-- ---------------------------------------------------------------- agents (the floor)
-- Seats are data, not drawing. More agents than seats is shown, never hidden.
create table office.agents (
  tenant_id    uuid not null references office.tenants (id),
  id           text not null check (id ~ '^[a-z0-9_]{2,40}$'),
  name         text not null,
  zone         text not null check (zone in ('intake', 'specialists', 'review')),
  pack_version integer not null default 1,
  seat_x       numeric(5, 2),
  seat_y       numeric(5, 2),
  active       boolean not null default true,
  primary key (tenant_id, id),
  unique (tenant_id, seat_x, seat_y)
);

-- ---------------------------------------------------------------- AI usage ledger
create table office.ai_runs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references office.tenants (id),
  finding_id          uuid,
  agent_id            text,
  call_type           text not null,
  model               text not null,
  prompt_version      text not null,
  kb_snapshot         text,
  status              text not null default 'queued'
                      check (status in ('queued', 'running', 'needs_review', 'accepted', 'rejected', 'failed')),
  input_tokens        integer,
  output_tokens       integer,
  cache_read_tokens   integer,
  cache_write_tokens  integer,
  cost_usd            numeric(10, 5),
  provider_request_id text,
  error               text,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  foreign key (tenant_id, finding_id) references office.findings (tenant_id, id),
  foreign key (tenant_id, agent_id) references office.agents (tenant_id, id),
  check (status <> 'failed' or error is not null)
);
create index ai_runs_day_idx on office.ai_runs (tenant_id, created_at desc);

-- ---------------------------------------------------------------- audit log
create table office.audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null references office.tenants (id),
  actor       text not null,
  event       text not null,
  record_type text not null,
  record_id   uuid,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);
create index audit_log_record_idx on office.audit_log (record_id, at);

create function office.audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update before update or delete on office.audit_log
  for each row execute function office.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on office.audit_log
  for each statement execute function office.audit_log_is_append_only();

-- Who is acting: set per transaction by the app with
--   select set_config('app.actor', '<who>', true)
create function office.current_actor() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.actor', true), ''), 'system')
$$;

-- ---------------------------------------------------------------- finding rules
create function office.finding_before_insert() returns trigger
language plpgsql as $$
declare n integer;
begin
  if new.ref is null then
    update office.tenants set next_finding_no = next_finding_no + 1
      where id = new.tenant_id
      returning next_finding_no - 1 into n;
    if n is null then raise exception 'unknown tenant %', new.tenant_id; end if;
    new.ref := 'F-' || lpad(n::text, 4, '0');
  end if;
  if new.status <> 'new' then
    raise exception 'a finding must start as new, not %', new.status;
  end if;
  return new;
end $$;

create trigger findings_before_insert before insert on office.findings
  for each row execute function office.finding_before_insert();

-- The lifecycle. Every status change goes through here, whoever makes it.
create function office.finding_before_update() returns trigger
language plpgsql as $$
declare
  ok boolean;
  clean_after_fix boolean;
  rule_in_force boolean;
begin
  new.updated_at := now();

  if new.tenant_id <> old.tenant_id or new.ref <> old.ref or new.fingerprint <> old.fingerprint then
    raise exception 'tenant, ref and fingerprint are permanent';
  end if;

  if new.status = old.status then
    return new;
  end if;

  ok := (old.status, new.status) in (
    ('new','triaged'), ('new','accepted'),
    ('triaged','assigned'), ('triaged','accepted'),
    ('assigned','fix_reported'), ('assigned','accepted'),
    ('fix_reported','verifying'), ('fix_reported','assigned'),
    ('verifying','closed'), ('verifying','assigned'),
    ('closed','recurred'),
    ('accepted','recurred'), ('accepted','triaged'),
    ('recurred','assigned'), ('recurred','accepted')
  );
  if not ok then
    raise exception 'illegal transition % -> %', old.status, new.status;
  end if;

  if new.status = 'triaged' and (new.area is null or new.severity is null or coalesce(trim(new.root_cause), '') = '') then
    raise exception 'triage needs area, severity and a root cause';
  end if;

  if new.status = 'assigned' then
    if new.owner_id is null or coalesce(trim(new.proposed_fix), '') = '' then
      raise exception 'assignment needs an owner and a proposed fix';
    end if;
    new.assigned_at := now();
    new.fix_reported_at := null;
  end if;

  if new.status = 'fix_reported' then
    new.fix_reported_at := now();
  end if;

  if new.status = 'accepted' and coalesce(trim(new.accepted_reason), '') = '' then
    raise exception 'accepting a risk needs a reason';
  end if;

  if new.status = 'closed' then
    select exists (
      select 1 from office.check_runs r
      join office.checks c on c.id = r.check_id
      where c.finding_id = new.id and r.result = 'clean' and r.ran_at >= old.fix_reported_at
    ) into clean_after_fix;
    if not clean_after_fix then
      raise exception 'cannot close: no clean check run recorded after the fix was reported';
    end if;
    select exists (
      select 1 from office.prevention_rules p
      where p.finding_id = new.id and p.status = 'in_force'
    ) into rule_in_force;
    if not rule_in_force then
      raise exception 'cannot close: no prevention rule in force';
    end if;
    new.closed_at := now();
  end if;

  if new.status = 'recurred' then
    new.recurrence_count := old.recurrence_count + 1;
    new.closed_at := null;
  end if;

  return new;
end $$;

create trigger findings_before_update before update on office.findings
  for each row execute function office.finding_before_update();

-- A recurrence means the prevention rule did not hold.
create function office.finding_after_update() returns trigger
language plpgsql as $$
begin
  if new.status = 'recurred' and old.status <> 'recurred' then
    update office.prevention_rules
      set status = 'failed', failed_at = now()
      where finding_id = new.id and status = 'in_force';
  end if;
  return null;
end $$;

create trigger findings_after_update after update on office.findings
  for each row execute function office.finding_after_update();

-- Every create and every status change is written to the audit log.
create function office.finding_audit() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into office.audit_log (tenant_id, actor, event, record_type, record_id, after)
    values (new.tenant_id, office.current_actor(), 'finding.created', 'finding', new.id,
            jsonb_build_object('ref', new.ref, 'status', new.status, 'source', new.source));
  elsif new.status <> old.status then
    insert into office.audit_log (tenant_id, actor, event, record_type, record_id, before, after)
    values (new.tenant_id, office.current_actor(), 'finding.status', 'finding', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;

create trigger findings_audit after insert or update on office.findings
  for each row execute function office.finding_audit();

-- ---------------------------------------------------------------- lock the schema
-- Row level security on, with no policies: nothing reaches these tables through
-- Supabase's browser API. The server connects as the table owner.
alter table office.tenants          enable row level security;
alter table office.members          enable row level security;
alter table office.owners           enable row level security;
alter table office.findings         enable row level security;
alter table office.evidence         enable row level security;
alter table office.checks           enable row level security;
alter table office.check_runs       enable row level security;
alter table office.prevention_rules enable row level security;
alter table office.agents           enable row level security;
alter table office.ai_runs          enable row level security;
alter table office.audit_log        enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema office from anon, authenticated';
  end if;
end $$;
