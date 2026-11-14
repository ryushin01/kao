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

| 경로 | 권한 | 내용 |
|---|---|---|
| `GET /api/showroom` | 공개 | 소개 화면용 모델·도장·열린 문제 수(위치·회원 정보 제외) |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | 공개 | 로그인(서명 쿠키 `kao_session`, 7일), 로그아웃, 현재 사용자와 웹 푸시 공개 키 |
| `GET /api/fleet` | 로그인 | 볼 수 있는 탈것의 현재 프레임 |
| `GET /api/fleet/stream` | 로그인 | 0.5초마다 프레임을 보내는 SSE. 50초마다 닫고 다시 연결 |
| `POST /api/vehicles/:id/actions` | 관제 요원 | `{ issueId, action }`. 맞지 않는 조치 422, 이미 조치 중 409 |
| `GET /api/vehicles/:id/history?metric=&minutes=` | 로그인(볼 수 있는 탈것) | 10·30·60분 지표 이력 120점 |
| `POST/DELETE /api/push/subscriptions`, `POST /api/push/test` | 로그인 | 웹 푸시 구독·해지, 시험 알림 |
| `GET /api/cron/notify` | `CRON_SECRET` | 위험 등급 문제 웹 푸시 |
| `POST /api/ingest/telemetry` | `INGEST_TOKEN` | 실차 측정값 수신([실차 연결](integration.md)) |

쿠키를 쓰는 변경 요청은 `Origin`이 같은 사이트일 때만 받습니다(SameSite=Lax에 더한 CSRF 방어).

### 시뮬레이션(`server/utils/sim/engine.ts`)

시간의 순수 함수입니다. 같은 시각과 같은 조치 기록이면 어느 서버에서든 같은 결과를 냅니다.

- **속도·위치**: 속도는 사인파 두 개의 합이라 거리를 적분식으로 바로 구합니다. 속도·출력 제한 조치가 걸린 90초는 제한을 넘은 만큼 수치 적분으로 뺍니다. 바퀴 수(`lap`, 매시 정각부터)와 진행률(`progress`)은 실제 속도로 달린 거리로 셉니다. 관제 지도 위치(`mapProgress`)만 움직임이 보이도록 같은 거리를 12배(`TIME_SCALE`) 해서 구하므로, 실제로 한 바퀴를 돌면 지도에서는 정확히 12바퀴를 돕니다. 화면의 카드·주행 위치 표·상세는 실제 속도 기준 값을 쓰고, 지도 제목에는 "지도 12배속"이라고 밝힙니다.
- **문제**: KST 0시부터 45초 칸마다 시드 난수로 후보를 뽑고, 같은 지표에 진행 중인 문제가 있거나 동시에 2건이면 건너뜁니다. 문제는 지표를 나쁜 쪽으로 천천히 밀고(경고 단계 2분 이상), 조치하면 멈춘 뒤 지수로 회복합니다. 조치가 없으면 15분 뒤 저절로 끝납니다. 문제 id는 `탈것-지표-날짜-칸`이라 조치 기록과 이어집니다.
- **이력**: 지난 시각을 다시 계산하므로 따로 저장하지 않습니다.

### 저장소(`server/utils/store/`)

`DATABASE_URL`이 있으면 Neon(`postgres.ts`), 없으면 메모리(`memory.ts`)를 씁니다. 로컬 개발·테스트·미리보기 배포는 메모리 저장소이며 데모 계정이 들어 있습니다. 스키마는 `server/db/schema.sql`, 적용은 `pnpm db:migrate`([배포](deploy.md)).

### 로그인과 화면 접근

- 계정: 관제 요원(`operator`)과 회원(`member01`~`04`, 각자 탈것 하나). 비밀번호는 scrypt로 해시합니다. 데모 계정 목록은 `src/shared/api/contract.ts`의 `DEMO_ACCOUNTS`.
- 화면 접근은 전역 라우트 미들웨어(`src/app/routes/auth-guard.ts`)가 정합니다: `/fleet`은 관제 요원만(회원은 자기 탈것으로), `/fleet/:id`는 관제 요원이나 그 탈것의 회원만.
- API도 같은 규칙을 서버에서 다시 확인합니다(`server/utils/session.ts`).

## 탈것 분류

분류와 대표 모델은 `src/entities/vehicle/config/categories.ts`의 `VEHICLE_CATEGORIES`에 있습니다(세단 `sedan`, 슈퍼카 `supercar`, 슈퍼바이크 `superbike`, 자전거 `bicycle`). 탈것의 분류는 서버 `fleet-specs.ts`의 `kind`로 정하고, 화면은 분류 이름을 `CATEGORY_LABELS`에서 가져옵니다. 소개 화면은 분류를 고르면 대표 모델을, 관제 센터는 분류 필터로 아래 목록을 거릅니다.

## 미니어처

### 실제 3D 모델 (G80, Aventador, Panigale)

1. Sketchfab에서 glTF로 받아 `assets-src/<모델 id>/`에 풉니다. 이 폴더는 git에 올리지 않습니다.
2. `pnpm build:models [모델 id]`로 `public/models/<모델 id>.glb`를 만듭니다. 설정은 `scripts/build-models.mjs`의 `MODELS`에 있습니다.
   - 모든 노드 변환을 메시에 굽고 실제 전장·+x 앞·바닥 y=0으로 맞춥니다(`forward`로 원본의 앞 방향 지정).
   - 이름이 제각각이라 바퀴는 위치로 고릅니다. `wheels`에 축 중심·반지름·폭을 적으면 그 원기둥 안의 삼각형을 `wheel_N` 노드(원점 = 축 중심)로 옮깁니다. 캘리퍼(`/calip/i`)는 몸체에 남깁니다.
   - `paint` 정규식에 맞는 재질에 `extras.kaoPaint`를 붙여 화면에서 회원 도장 색으로 바꿉니다.
   - `--inspect`를 붙이면 맞춘 뒤 재질별 위치·삼각형 수를 출력합니다. 바퀴 좌표와 도장 재질은 이 값으로 정합니다.
   - 관제 지도용 가벼운 버전(`.lite.glb`)도 함께 만듭니다. 큰 부품만 크게 줄이고, 작은 부품(삼각형 1,500개 미만)은 가장자리를 잠근 채 조금만 줄이며, 반투명 유리는 줄이지 않습니다(얇은 열린 면이라 줄이면 구멍이 남). `--lite-only`는 이미 만든 GLB에서 가벼운 버전만 다시 만듭니다.
3. 화면은 `MODEL_ASSETS`(`src/entities/vehicle/config/model-assets.ts`)에 등록된 모델만 불러오고, 출처는 README의 '출처' 표에 적고, 푸터에는 그 표로 가는 링크만 둡니다(CC BY 4.0).

화면은 직접 만든 모형을 먼저 그리고, `loadModelMiniature`로 GLB를 받으면 바꿔 끼웁니다. 받지 못하면 직접 만든 모형을 계속 씁니다.

## 성능

3D는 무거우므로 화면에 보일 때가 되어서야 준비합니다.

- **소개 화면의 블랙홀 배경**은 셰이더 하나만 그리므로 three.js 없이 WebGL을 직접 씁니다(`widgets/event-horizon/lib/shader-canvas.ts`). 소개 화면 첫 로딩에서 three.js를 받지 않습니다.
- **턴테이블과 관제 지도**는 화면 가까이(300px) 왔을 때(`whenNearViewport`) three.js와 3D 모델을 받아 장면을 만듭니다.
- 장면을 만들 때 3D 모델 다운로드(`preloadModel`)를 조명 환경(PMREM) 계산보다 먼저 걸고, meshopt 압축은 웹 워커 2개에서 풉니다. 관제 지도는 모형이 작게 보여 반사 지도 해상도를 64로 낮춥니다(턴테이블은 256).

Lighthouse(모바일 조건, GPU, 3회 중앙값)로 잰 결과입니다.

| 화면 | 점수 | TBT | 전체 전송량 |
|---|---|---|---|
| 소개 | 74 → 100 | 1,500 → 18ms | 3.1 → 0.6MB |
| 아벤타도르 상세 | 70 → 81 | 2,703 → 774ms | 4.0 → 3.2MB |

재 볼 때는 프로덕션 빌드를 띄우고 `CHROME_PATH=<Chrome> pnpm dlx lighthouse@13.6.0 <주소> --only-categories=performance --chrome-flags="--headless=new --use-angle=metal --enable-gpu"`처럼 GPU로 그리게 합니다. GPU 없이(SwiftShader) 재면 WebGL 그리기가 메인 스레드 시간에 섞여 TBT가 수 초로 부풀어 비교가 어렵습니다.

### 직접 만든 모형

`src/entities/vehicle/lib/miniatures/`에 모델마다 파일이 하나씩 있습니다. 옆모습 윤곽을 밀어 낸 몸체(`extrudeProfile`), 바퀴 자리를 파낸 바닥선(`sillWithArches`), 원통·상자 부품으로 만들며 좌표는 실제 치수(m)입니다. 관제 지도에서는 차종별 길이로 맞춰 키우고, 이륜차는 `leanPivot`으로 코너 안쪽으로 기울입니다.

## 테스트

| 명령 | 내용 |
|---|---|
| `pnpm test` | Vitest(happy-dom): 시뮬레이션(같은 시각 같은 결과, 조치 흐름, 이력), 세션 서명·비밀번호·저장소, 공통 UI·그래프(키보드), 로그인 폼, 원격 조치(확인·더블 클릭·실패·회원 화면) |
| `pnpm test:e2e` | Playwright: 프로덕션 빌드(`pnpm build` 먼저)를 데스크톱·모바일에서 검사. axe(WCAG 2.2 AA 태그), 가로 넘침, 원격 조치 흐름, 로그인·권한, 404. 화면 검사는 3D 모델 요청을 막고(`tests/e2e/fixtures.ts`), 실제 모델 로드는 `models.spec.ts`에서 따로 확인 |
| `pnpm storybook` | 공통 UI·엔티티·기능 컴포넌트 스토리 |

axe를 통과해도 KWCAG 2.2를 모두 만족하는 것은 아니므로 새 화면은 키보드, 화면 낭독기, 정지 기능을 직접 확인합니다.

## CI

`.github/workflows/ci.yml`이 푸시와 PR마다 설치(`--frozen-lockfile`) → ESLint → Steiger → 타입 검사 → 단위 테스트 → 빌드 → Storybook 빌드 → E2E를 차례로 돌립니다. E2E는 CI에서 브라우저 2개만 동시에 띄웁니다(GPU 없이 WebGL을 CPU로 그리므로, 코어가 많은 기기에서 `CI=1`로 돌려도 GitHub CI와 같은 조건이 되게). 의존성의 빌드 스크립트는 `pnpm-workspace.yaml`의 `allowBuilds`에 허용한 것만 실행됩니다.
