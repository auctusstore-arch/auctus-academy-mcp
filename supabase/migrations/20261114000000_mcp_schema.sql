-- Proposed mcp schema for Auctus MCP Server (Phase 0). DO NOT apply from this repo without Muhammad's approval.
begin;

create schema if not exists mcp;
grant usage on schema mcp to authenticated;

-- OAuth connections visible to the user (mirrors grants; authoritative store remains OAuth KV until dual-write phase).
create table if not exists mcp.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text,
  client_host text,
  scopes text[] not null default '{}',
  grant_id text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text
);

create unique index if not exists mcp_connections_active_uidx
  on mcp.connections (user_id, client_id, grant_id)
  where revoked_at is null;

alter table mcp.connections enable row level security;
revoke all on mcp.connections from anon;
grant select, update on mcp.connections to authenticated;

create policy mcp_connections_select_own on mcp.connections
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy mcp_connections_update_revoke_own on mcp.connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Append-only audit log (hash chain verified by nightly job in academy app).
create table if not exists mcp.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text,
  grant_id text,
  tool_name text not null,
  scope text,
  args_hash text not null,
  status text not null check (status in ('ok', 'denied', 'error')),
  record_count integer,
  change_set_id uuid,
  ip_country text,
  user_agent text,
  prev_hash text not null,
  event_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_audit_events_user_created_idx
  on mcp.audit_events (user_id, created_at desc);

alter table mcp.audit_events enable row level security;
revoke all on mcp.audit_events from anon, authenticated;
revoke insert, update, delete on mcp.audit_events from authenticated;

-- Phase 1 placeholders (RLS pre-defined).
create table if not exists mcp.change_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  tool_name text not null,
  status text not null default 'pending'
    check (status in ('applied', 'pending', 'approved', 'rejected', 'reverted', 'expired')),
  summary text,
  payload_hash text not null,
  created_at timestamptz not null default now()
);

alter table mcp.change_sets enable row level security;
revoke all on mcp.change_sets from anon;
grant select on mcp.change_sets to authenticated;

create policy mcp_change_sets_select_own on mcp.change_sets
  for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists mcp.change_items (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references mcp.change_sets(id) on delete cascade,
  entity_table text not null,
  entity_id text not null,
  before_json jsonb,
  after_json jsonb
);

alter table mcp.change_items enable row level security;
revoke all on mcp.change_items from anon;
grant select on mcp.change_items to authenticated;

create policy mcp_change_items_select_via_set on mcp.change_items
  for select to authenticated
  using (
    exists (
      select 1 from mcp.change_sets cs
      where cs.id = change_set_id and cs.user_id = (select auth.uid())
    )
  );

-- Beta pilot allowlist (user-level); complements Worker KV pilot client allowlist.
create table if not exists mcp.pilot_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table mcp.pilot_users enable row level security;
revoke all on mcp.pilot_users from anon, authenticated;

-- Inserts only via security definer RPC (not exposed in Phase 0).
create or replace function mcp.append_audit_event(
  p_user uuid,
  p_client_id text,
  p_tool text,
  p_scope text,
  p_args_hash text,
  p_status text,
  p_prev_hash text
) returns mcp.audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_row mcp.audit_events;
begin
  if p_status not in ('ok', 'denied', 'error') then
    raise exception 'invalid status';
  end if;
  v_hash := encode(extensions.digest(
    convert_to(
      json_build_object(
        'user', p_user,
        'client', p_client_id,
        'tool', p_tool,
        'scope', p_scope,
        'args', p_args_hash,
        'status', p_status,
        'prev', p_prev_hash,
        'at', now()
      )::text,
      'UTF8'
    ),
    'sha256'
  ), 'hex');
  insert into mcp.audit_events (
    user_id, client_id, tool_name, scope, args_hash, status, prev_hash, event_hash
  ) values (
    p_user, p_client_id, p_tool, p_scope, p_args_hash, p_status, p_prev_hash, v_hash
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function mcp.append_audit_event(uuid, text, text, text, text, text, text) from public, anon, authenticated;

commit;