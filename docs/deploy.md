# 배포

Vercel 프로젝트 `kao` 하나에 화면(Nuxt SSR)과 `/api` 함수를 함께 올립니다. DB는 Vercel Marketplace로 연결한 Neon(Postgres)입니다.

| 항목 | 값 |
|---|---|
| 운영 주소 | https://kao-ryushin01.vercel.app |
| 운영 브랜치 | `main` (PR마다 미리보기 배포) |
| 함수 지역 | 싱가포르 `sin1` (Neon DB와 같은 지역) — `nuxt.config.ts`의 `nitro.vercel.functions` |
| 함수 최대 실행 | 60초. 관제 스트림(SSE)은 50초마다 닫고 브라우저(EventSource)가 다시 연결합니다 |
| 빌드 명령 | `vercel-build` = `node scripts/migrate.mjs && nuxt build` |

> Vercel Hobby와 Neon 무료 요금제의 한도(함수 실행 시간, DB 용량·컴퓨트, 크론 횟수)는 바뀔 수 있으니 공식 문서에서 확인하세요.

## 서버리스에서 상태를 다루는 방법

요청마다 다른 인스턴스가 응답할 수 있어 서버 메모리에 상태를 두지 않습니다.

- **시뮬레이션은 시간의 순수 함수**입니다(`server/utils/sim/engine.ts`). 같은 시각이면 어느 인스턴스든 같은 위치·지표·문제를 냅니다.
- **사람과 차량이 바꾸는 것만 DB에 저장**합니다: 원격 조치와 실차 명령 응답(`remote_actions`), 실측 문제(`live_issues`), 실차 측정값·GPS(`telemetry_readings`), 계정, 웹 푸시 구독, 보낸 알림. 동시에 들어오는 요청은 DB 제약으로 가립니다: 같은 문제에 응답을 기다리는 조치는 하나(`remote_actions_pending_issue`), 같은 탈것·지표에 해결되지 않은 실측 문제는 하나(`live_issues_open`), 실측 문제는 읽은 `checked_at`이 그대로일 때만 바꿈.
- 프레임은 0.5초마다 만들지만 조치·실측 문제·측정값은 1.5초 동안 인스턴스 메모리에 기억합니다. 다른 인스턴스에서 바뀐 것은 길어야 1.5초 뒤에 보입니다.

## DB와 마이그레이션

- Neon 연동은 **운영 환경에만** 연결했습니다. 미리보기 배포에는 `DATABASE_URL`이 없어 메모리 저장소로 동작합니다(로그인은 되지만 인스턴스마다 조치 기록이 따로 있음).
- 운영 빌드 때 `scripts/migrate.mjs`가 `server/db/schema.sql`을 적용하고(여러 번 실행해도 안전), 데모 계정을 맞추고, 오래된 기록(측정값 하루, 조치·해결한 실측 문제·알림 기록 7일)을 지웁니다. 측정값은 수신 API도 10분마다 하루 지난 것을 지웁니다. 풀러를 거치지 않는 `DATABASE_URL_UNPOOLED`를 씁니다.

## 환경 변수

| 이름 | 환경 | 내용 |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | 운영 | Neon 연동이 자동으로 넣음 |
| `SESSION_SECRET` | 운영·미리보기 | 로그인 쿠키 서명 키. 운영에 없으면 서버가 시작하지 않습니다 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | 운영·미리보기 | 웹 푸시 키 쌍(`web-push`의 `generateVAPIDKeys()`). 없으면 알림 버튼을 숨깁니다 |
| `VAPID_SUBJECT` | 선택 | 푸시 서비스에 알리는 연락처(URL). 기본값은 운영 주소 |
| `CRON_SECRET` | 운영 | `/api/cron/notify` 인증. Cloudflare 워커 비밀·GitHub 저장소 비밀에도 같은 값(바꿀 때 세 곳을 함께) |
| `INGEST_TOKEN` | 운영 | 실차 측정값 수신 API 인증([실차 연결](integration.md)) |

비밀 값은 Vercel에 읽을 수 없는 Secret으로 넣었습니다. 바꾸려면 `vercel env rm` 후 다시 `vercel env add`합니다.

## 위험 알림(웹 푸시)

- 브라우저가 서비스 워커(`public/sw.js`)로 구독하고, 구독은 `push_subscriptions`에 저장합니다. 권한은 헤더의 **위험 알림** 버튼을 눌렀을 때만 요청합니다.
- **5분마다** Cloudflare Workers 크론 트리거(`workers/notify-cron`)가 `/api/cron/notify`를 부릅니다. Vercel Hobby의 크론은 하루 한 번뿐이고, GitHub Actions 예약 실행은 2026-11-14 확인 때 5시간 넘게 한 번도 돌지 않아(같은 계정 다른 저장소의 주간 예약도 8시간 반 늦음) 쓰지 않습니다. `.github/workflows/notify.yml`은 손으로 한 번 부를 때 쓰는 수동 실행용입니다.
- 관제 화면이 열려 있으면 스트림이, 실차 측정값이 들어오면 수신 API가 30초마다(인스턴스마다) 함께 검사합니다.
- 위험 등급이 된 열린 문제마다 구독마다 한 번만 보냅니다(`push_deliveries`). 보내지 못하면 기록을 지워 다음 검사 때 다시 보냅니다. 관제 요원은 전체, 회원은 자기 탈것의 문제만 받습니다.

## 5분 알림 크론(Cloudflare Workers)

`workers/notify-cron`은 크론으로만 실행되는 워커입니다(HTTP 주소를 열지 않음, `workers_dev = false`). 부르는 주소는 `wrangler.toml`의 `SITE_URL`, 인증은 워커 비밀 `CRON_SECRET`입니다.

아래 명령은 모두 저장소 루트에서 실행합니다(`--config`의 경로가 저장소 루트 기준).

```bash
npx wrangler@4.162.0 deploy --config workers/notify-cron/wrangler.toml                   # 크론 트리거(*/5 * * * *)와 함께 배포
npx wrangler@4.162.0 secret put CRON_SECRET --config workers/notify-cron/wrangler.toml   # Vercel·GitHub와 같은 값(표준 입력)
npx wrangler@4.162.0 tail kao-notify-cron                                                # 실행 로그(상태 코드와 보낸 알림 수)
```

`CRON_SECRET`은 세 곳 모두 다시 읽을 수 없는 비밀이라, 바꿀 때는 새 값을 만들어 세 곳에 함께 넣고 Vercel을 다시 배포합니다. 로컬에는 커밋하지 않는 `.env.cron.local`에 사본을 둡니다. 세 곳의 값이 어긋나지 않도록 한 단계라도 실패하면 거기서 멈추게 이어 실행합니다(저장소 루트에서).

```bash
SECRET=$(openssl rand -hex 32) &&
  { vercel env rm CRON_SECRET production -y || true; } &&
  printf '%s' "$SECRET" | vercel env add CRON_SECRET production --sensitive &&
  printf '%s' "$SECRET" | gh secret set CRON_SECRET &&
  printf '%s' "$SECRET" | npx wrangler@4.162.0 secret put CRON_SECRET --config workers/notify-cron/wrangler.toml &&
  (umask 077 && printf 'CRON_SECRET=%s\n' "$SECRET" > .env.cron.local)
```

중간에 멈췄다면 고친 뒤 같은 블록을 처음부터 다시 실행합니다(새 값으로 세 곳을 다시 맞춤). Vercel에서 지우는 단계는 이미 지워져 있어도 넘어가므로, 추가 단계에서 멈췄을 때도 다시 실행하면 됩니다.

## 배포된 사이트 확인

```bash
curl -s https://kao-ryushin01.vercel.app/api/showroom          # 공개 요약
curl -s -c jar -H 'content-type: application/json' \
  -d '{"login":"operator","password":"kao-demo-2026"}' https://kao-ryushin01.vercel.app/api/auth/login
curl -sN -b jar https://kao-ryushin01.vercel.app/api/fleet/stream  # 0.5초마다 frame 이벤트
```
