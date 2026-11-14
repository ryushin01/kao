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
- **사람이 바꾸는 것만 DB에 저장**합니다: 원격 조치(`remote_actions`, 문제마다 하나 — `issue_id` 유일), 계정, 웹 푸시 구독, 보낸 알림, 실차 측정값.
- 프레임은 0.5초마다 만들지만 조치 기록은 1.5초 동안 인스턴스 메모리에 기억합니다. 다른 인스턴스에서 보낸 조치는 길어야 1.5초 뒤에 보입니다.

## DB와 마이그레이션

- Neon 연동은 **운영 환경에만** 연결했습니다. 미리보기 배포에는 `DATABASE_URL`이 없어 메모리 저장소로 동작합니다(로그인은 되지만 인스턴스마다 조치 기록이 따로 있음).
- 운영 빌드 때 `scripts/migrate.mjs`가 `server/db/schema.sql`을 적용하고(여러 번 실행해도 안전), 데모 계정을 맞추고, 오래된 기록(측정값 하루, 조치·알림 기록 7일)을 지웁니다. 풀러를 거치지 않는 `DATABASE_URL_UNPOOLED`를 씁니다.

## 환경 변수

| 이름 | 환경 | 내용 |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | 운영 | Neon 연동이 자동으로 넣음 |
| `SESSION_SECRET` | 운영·미리보기 | 로그인 쿠키 서명 키. 운영에 없으면 서버가 시작하지 않습니다 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | 운영·미리보기 | 웹 푸시 키 쌍(`web-push`의 `generateVAPIDKeys()`). 없으면 알림 버튼을 숨깁니다 |
| `VAPID_SUBJECT` | 선택 | 푸시 서비스에 알리는 연락처(URL). 기본값은 운영 주소 |
| `CRON_SECRET` | 운영 | `/api/cron/notify` 인증. GitHub 저장소 비밀에도 같은 값 |
| `INGEST_TOKEN` | 운영 | 실차 측정값 수신 API 인증([실차 연결](integration.md)) |

비밀 값은 Vercel에 읽을 수 없는 Secret으로 넣었습니다. 바꾸려면 `vercel env rm` 후 다시 `vercel env add`합니다.

## 위험 알림(웹 푸시)

- 브라우저가 서비스 워커(`public/sw.js`)로 구독하고, 구독은 `push_subscriptions`에 저장합니다. 권한은 헤더의 **위험 알림** 버튼을 눌렀을 때만 요청합니다.
- Vercel Hobby의 크론은 하루 한 번뿐이라 `.github/workflows/notify.yml`이 **5분마다** `/api/cron/notify`를 부릅니다(`CRON_SECRET` 비밀, `SITE_URL` 변수). 관제 화면이 열려 있으면 스트림이 30초마다 함께 검사합니다. GitHub 예약 실행은 몇 분 늦을 수 있습니다.
- 위험 등급이 된 열린 문제마다 한 번만 보냅니다(`push_notifications`). 관제 요원은 전체, 회원은 자기 탈것의 문제만 받습니다.

## 배포된 사이트 확인

```bash
curl -s https://kao-ryushin01.vercel.app/api/showroom          # 공개 요약
curl -s -c jar -H 'content-type: application/json' \
  -d '{"login":"operator","password":"kao-demo-2026"}' https://kao-ryushin01.vercel.app/api/auth/login
curl -sN -b jar https://kao-ryushin01.vercel.app/api/fleet/stream  # 0.5초마다 frame 이벤트
```
