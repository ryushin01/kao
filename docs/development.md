# 개발 가이드

## 구조

Nuxt 4의 `app/` 폴더는 라우트와 진입점만 둡니다. 화면 코드는 모두 `src/`에 [Feature-Sliced Design v2.1](https://feature-sliced.design) 계층으로 나눕니다.

| 위치 | 역할 |
|---|---|
| `app/app.vue`, `app/error.vue` | `@app`, `@pages/not-found`를 그리기만 합니다 |
| `app/pages/**.ts` | `src/pages`의 페이지 컴포넌트를 다시 내보내기만 합니다 |
| `src/app` | 진입 컴포넌트(`entrypoint`)와 전역 스타일(`styles`) |
| `src/pages` | 소개(`home`), 관제 센터(`fleet`), 탈것 상세(`vehicle`), 오류(`not-found`) |
| `src/widgets` | 헤더, 푸터, 블랙홀 배경, 관제 지도, 미니어처 전시, 조치 기록, 화면 낭독기 알림 |
| `src/features/remote-action` | 원격 조치 확인과 전송 |
| `src/entities/vehicle` | 모델 제원, 미니어처 3D 모델, 실시간 스트림, 지표·카드 UI |
| `src/shared` | API 계약과 요청(`api`), 경로 좌표(`config`), 포맷·모션·Three.js 무대(`lib`), 기본 UI(`ui`) |
| `server/` | Nitro API와 주행 시뮬레이션 |

- 슬라이스는 공개 API(`index.ts`)로만 가져옵니다. 별칭은 `@app`, `@pages`, `@widgets`, `@features`, `@entities`, `@shared`입니다.
- Nuxt의 자동 가져오기는 끄고(`imports.autoImport: false`) `vue`, `#imports`, `#components`에서 직접 가져옵니다. 그래서 컴포넌트를 Storybook과 Vitest에서 Nuxt 없이 그릴 수 있습니다.
- `pnpm lint:fsd`(Steiger)로 계층 규칙을 검사합니다.

## 서버와 시뮬레이션

| 경로 | 내용 |
|---|---|
| `GET /api/fleet` | 현재 프레임(4대의 위치·지표·문제, 조치 기록) |
| `GET /api/fleet/stream` | 0.5초마다 프레임을 보내는 Server-Sent Events |
| `POST /api/vehicles/:id/actions` | `{ issueId, action }`으로 원격 조치. 잘못된 조치는 422, 이미 조치 중이면 409 |

- `server/utils/fleet-specs.ts`: 탈것별 지표, 경고·위험 기준, 문제와 쓸 수 있는 조치
- `server/utils/fleet-engine.ts`: 시드 난수를 쓰는 순수 시뮬레이션. 요청이 올 때 지난 시간만큼 0.5초 단위로 진행합니다.
- 위치는 실제 속도의 12배(`TIME_SCALE`)로 움직입니다. 지표 값은 배속하지 않습니다.
- 상태는 서버 메모리에 있으므로 서버를 다시 켜면 처음부터 시작합니다. 서버가 여러 개인 환경(서버리스)에서는 인스턴스마다 다른 상태를 갖습니다.

## 미니어처

`src/entities/vehicle/lib/miniatures/`에 모델마다 파일이 하나씩 있습니다. 옆모습 윤곽을 밀어 낸 몸체(`extrudeProfile`), 바퀴 자리를 파낸 바닥선(`sillWithArches`), 원통·상자 부품으로 만들며 좌표는 실제 치수(m)입니다. 관제 지도에서는 차종별 길이로 맞춰 키우고, 이륜차는 `leanPivot`으로 코너 안쪽으로 기울입니다.

## 테스트

| 명령 | 내용 |
|---|---|
| `pnpm test` | Vitest(happy-dom): 시뮬레이션, 공통 UI, 지표·카드, 원격 조치(확인·더블 클릭·실패) |
| `pnpm test:e2e` | Playwright: 프로덕션 빌드(`pnpm build` 먼저)를 데스크톱·모바일에서 검사. axe(WCAG 2.2 AA 태그), 가로 넘침, 원격 조치 흐름, 404 |
| `pnpm storybook` | 공통 UI·엔티티·기능 컴포넌트 스토리 |

axe를 통과해도 KWCAG 2.2를 모두 만족하는 것은 아니므로 새 화면은 키보드, 화면 낭독기, 정지 기능을 직접 확인합니다.

## CI

`.github/workflows/ci.yml`이 푸시와 PR마다 설치(`--frozen-lockfile`) → ESLint → Steiger → 타입 검사 → 단위 테스트 → 빌드 → Storybook 빌드 → E2E를 차례로 돌립니다. 의존성의 빌드 스크립트는 `pnpm-workspace.yaml`의 `allowBuilds`에 허용한 것만 실행됩니다.
