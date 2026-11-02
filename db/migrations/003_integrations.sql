-- Credentials an app installation hands back (e.g. Shopify OAuth). The token is
-- stored encrypted (AES-256-GCM, key in TOKEN_ENCRYPTION_KEY, never in the
-- database), and only read-only scopes are ever accepted.
create table office.integrations (
  tenant_id    uuid not null references office.tenants (id),
  provider     text not null check (provider in ('shopify')),
  account      text not null,                 -- e.g. 666ef0-2.myshopify.com
  scopes       text not null,
  token_enc    text not null,                 -- base64(iv | tag | ciphertext)
  installed_by text not null,
  installed_at timestamptz not null default now(),
  primary key (tenant_id, provider),
  check (scopes !~ '(^|,)\s*write_')
);
alter table office.integrations enable row level security;
