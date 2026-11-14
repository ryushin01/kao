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

-- 원격 조치. 시뮬레이션 조치는 문제마다 하나이고, 실차 명령은 차량 응답을 기다리는 것이 문제마다 하나뿐입니다
-- (동시에 보내면 한쪽만 들어감). 실차 명령은 차량이 받아 간 시각과 응답(applied, failed, 응답 없음은 timeout)을 남깁니다.
create table if not exists remote_actions (
  id text primary key,
  issue_id text not null,
  vehicle_id text not null,
  action text not null,
  sent_at bigint not null,
  user_id text references users (id) on delete set null,
  delivered_at bigint,
  acked_at bigint,
  ack_result text check (ack_result in ('applied', 'failed', 'timeout')),
  ack_message text
);
alter table remote_actions add column if not exists delivered_at bigint;
alter table remote_actions add column if not exists acked_at bigint;
alter table remote_actions add column if not exists ack_result text check (ack_result in ('applied', 'failed', 'timeout'));
alter table remote_actions add column if not exists ack_message text;
-- 0.4.0 전에는 issue_id 전체가 유일했습니다. 실차 명령은 실패하면 같은 문제에 다시 보내므로 응답을 기다리는 것만 유일하게 둡니다.
alter table remote_actions drop constraint if exists remote_actions_issue_id_key;
create unique index if not exists remote_actions_pending_issue on remote_actions (issue_id) where ack_result is null;
create index if not exists remote_actions_sent_at on remote_actions (sent_at);
create index if not exists remote_actions_pending_vehicle on remote_actions (vehicle_id, sent_at) where ack_result is null;

create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_id text not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 같은 문제를 같은 구독에 두 번 보내지 않도록 보낸 기록을 남깁니다. 보내지 못하면 지워 다음 검사 때 다시 보냅니다.
drop table if exists push_notifications;
create table if not exists push_deliveries (
  issue_id text not null,
  endpoint text not null,
  sent_at timestamptz not null default now(),
  primary key (issue_id, endpoint)
);

-- 실제 차량에서 받은 측정값(/api/ingest/telemetry). GPS가 있으면 경로 위 위치(route_progress, 경로 밖이면 null)와
-- 매시 정각부터 경로를 따라 간 거리(odometer, 바퀴 단위)를 함께 남깁니다.
create table if not exists telemetry_readings (
  id bigserial primary key,
  vehicle_id text not null,
  at bigint not null,
  speed double precision,
  metrics jsonb not null default '{}',
  lat double precision,
  lng double precision,
  route_progress double precision,
  odometer double precision
);
alter table telemetry_readings add column if not exists lat double precision;
alter table telemetry_readings add column if not exists lng double precision;
alter table telemetry_readings add column if not exists route_progress double precision;
alter table telemetry_readings add column if not exists odometer double precision;
create index if not exists telemetry_readings_at on telemetry_readings (at);
create index if not exists telemetry_readings_vehicle_at on telemetry_readings (vehicle_id, at);

-- 실측값이 기준을 넘어 연 문제. 같은 탈것·지표에 해결되지 않은 문제는 하나뿐입니다.
-- checked_at은 마지막으로 반영한 측정 시각입니다. 바꿀 때 이 값이 그대로인지 확인해 겹친 요청끼리 덮어쓰지 않습니다.
create table if not exists live_issues (
  id text primary key,
  vehicle_id text not null,
  metric_key text not null,
  severity text not null check (severity in ('warning', 'critical')),
  detected_at bigint not null,
  cleared_at bigint,
  resolved_at bigint,
  checked_at bigint not null
);
create unique index if not exists live_issues_open on live_issues (vehicle_id, metric_key) where resolved_at is null;
create index if not exists live_issues_resolved_at on live_issues (resolved_at);
create index if not exists live_issues_vehicle_metric on live_issues (vehicle_id, metric_key);

-- 실차 장치(0.9.0). 토큰은 탈것 하나에 묶이고 SHA-256만 남깁니다(pnpm device add가 만들 때 한 번만 보여 줌).
-- webhook_url이 있으면 원격 조치 명령을 그 주소로 보냅니다(HMAC-SHA256 서명, https만).
create table if not exists devices (
  id text primary key,
  vehicle_id text not null,
  name text not null,
  token_hash text not null unique,
  created_at bigint not null,
  revoked_at bigint,
  last_seen_at bigint,
  webhook_url text check (webhook_url like 'https://%'),
  webhook_secret text
);
create index if not exists devices_vehicle on devices (vehicle_id) where revoked_at is null;
