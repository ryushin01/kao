-- KAO 스키마. scripts/migrate.mjs가 운영 배포 빌드 때 적용합니다(여러 번 실행해도 안전).
create table if not exists users (
  id text primary key,
  login text unique not null,
  name text not null,
  role text not null check (role in ('operator', 'member')),
  vehicle_ids text[] not null default '{}',
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- 원격 조치. 문제 하나에 조치는 하나뿐이므로 issue_id가 유일합니다(동시에 보내면 한쪽만 들어감).
create table if not exists remote_actions (
  id text primary key,
  issue_id text unique not null,
  vehicle_id text not null,
  action text not null,
  sent_at bigint not null,
  user_id text references users (id) on delete set null
);
create index if not exists remote_actions_sent_at on remote_actions (sent_at);

create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_id text not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 같은 문제로 알림을 두 번 보내지 않도록 보낸 문제를 기록합니다.
create table if not exists push_notifications (
  issue_id text primary key,
  sent_at timestamptz not null default now()
);

-- 실제 차량에서 받은 측정값(/api/ingest/telemetry)
create table if not exists telemetry_readings (
  id bigserial primary key,
  vehicle_id text not null,
  at bigint not null,
  speed double precision,
  metrics jsonb not null default '{}'
);
create index if not exists telemetry_readings_at on telemetry_readings (at);
