# KAO — 에이전트 작업 안내

이 저장소에서 일하는 에이전트(Codex, Claude Code 등)를 위한 규칙입니다. 자세한 설명은 [개발 가이드](docs/development.md), [배포](docs/deploy.md), [실차 연결](docs/integration.md)에 있습니다.

## 1. 프로젝트 개요

- KAO(Kinetic Aero One): 회원의 자동차·모터사이클·자전거 주행 상태를 실시간으로 지켜보고 원격으로 조치하는 관제 서비스입니다. 실제 차량 대신 서버의 시간 기반 주행 시뮬레이션이 데이터를 만들고, 회원·주행 기록은 모두 가상 데이터입니다.
- 화면 축: 관제 웹(소개, 로그인, 관제 센터, 탈것 상세)와 Nuxt 서버 API. 관제 요원은 모든 탈것과 원격 조치, 회원은 자기 탈것만 봅니다.
- 운영·데모: https://kao-ryushin01.vercel.app/ (로그인 화면의 데모 계정 버튼, 비밀번호는 README 참고)

## 2. 기술 스택과 구조

- Nuxt 4, Vue 3, TypeScript 6, Three.js(미니어처·GLSL 셰이더·3D 지도), Nitro(h3) API와 SSE, Neon(`@neondatabase/serverless`), Web Push(`web-push`, 서비스 워커), Cloudflare Workers 크론.
- `app/`은 Nuxt 라우트·진입점만 두고 `src/`를 다시 내보내기만 합니다. 서버는 `server/`(시뮬레이션·실차 연동 `server/utils/sim/`, 저장소 `server/utils/store/`, 스키마 `server/db/schema.sql`), 크론은 `workers/notify-cron`입니다.
- Feature-Sliced Design v2.1. 층 순서(위가 아래를 가져옴): `src/app` → `src/pages` → `src/widgets` → `src/features` → `src/entities` → `src/shared`.
  - 슬라이스는 공개 API(`index.ts`)로만 가져옵니다. 별칭은 `@app`, `@pages`, `@widgets`, `@features`, `@entities`, `@shared`입니다.
  - three.js를 쓰는 코드는 공개 API를 따로 둡니다(`@entities/vehicle/index.three`, `@shared/lib/three`). 한 공개 API에 섞으면 three.js가 필요 없는 화면에도 붙습니다.
  - Nuxt 자동 가져오기는 끕니다(`imports.autoImport: false`). `vue`, `#imports`, `#components`에서 직접 가져옵니다.
  - Steiger(`pnpm lint:fsd`)로 검사합니다.

## 3. 설치·개발 명령

- Node.js 24(`.nvmrc`, `engines`는 `>=22.18`), pnpm 12(`packageManager: pnpm@12.16.1`).

```bash
corepack enable pnpm
pnpm install          # postinstall: nuxt prepare
pnpm dev              # http://localhost:3000
pnpm build && pnpm preview
pnpm storybook        # http://localhost:6006
```

- 그 밖의 명령: `pnpm fonts`(Python `fontTools` 필요), `pnpm icons`, `pnpm build:models`, `pnpm build:map`, `pnpm db:migrate`, `pnpm live:demo`, `pnpm device`, `pnpm screenshots`(먼저 `pnpm build`).
- `DATABASE_URL`이 없으면 메모리 저장소와 데모 계정으로 돕니다. 로컬 개발·테스트는 이 상태로 합니다.
- 환경 변수(이름만, [배포](docs/deploy.md#환경-변수)): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `INGEST_TOKEN`.

## 4. 검사·테스트 명령

CI(`.github/workflows/ci.yml`)가 푸시와 PR마다 도는 순서입니다. PR 전에 로컬에서도 돌립니다.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm lint:fsd
pnpm typecheck
pnpm test                 # Vitest(happy-dom)
pnpm build
pnpm build-storybook --quiet
pnpm exec playwright install --with-deps chromium
pnpm test:e2e             # 프로덕션 빌드를 데스크톱·모바일에서, axe(WCAG 2.2 AA)
```

- E2E는 3D 모델 요청을 막고 돕니다(`tests/e2e/fixtures.ts`). 실제 모델은 `models.spec.ts`, 실차 연동은 `live` 프로젝트, 서비스 워커 오프라인은 `offline.spec.ts`가 따로 봅니다.
- `offline-network.spec.ts`는 `DATABASE_URL` 없이 띄운 운영 빌드에서 localhost 밖 요청을 모두 막고 모든 화면이 내용과 함께 뜨는지(사이트 안 요청 실패·런타임 오류·axe 위반 없음) 봅니다. 화면에 외부 요청(CDN 글꼴·원격 지도·외부 API)을 새로 넣으면 이 검사가 깨지므로 저장소 파일로 둡니다([오프라인](docs/development.md#오프라인)).
- 단위 테스트는 `src/`, `server/`, `workers/` 아래 `*.test.ts`에 둡니다.
- CI는 E2E 브라우저를 2개만 띄웁니다. 코어가 많은 기기에서 `CI=1`로 돌리면 같은 조건이 됩니다.
- 의존성의 빌드 스크립트는 `pnpm-workspace.yaml`의 `allowBuilds`에 허용한 것만 실행됩니다.
- **Testing Library 원칙**: 구현 세부가 아니라 사용자가 보는 동작을 검사하고, 요소는 역할·이름(`getByRole`)으로 찾습니다. 단위·컴포넌트는 Vitest + **Vue Test Utils**(`@vue/test-utils`, happy-dom)이고 Testing Library 패키지는 쓰지 않습니다(표준과 다른 점, 컴포넌트 테스트는 `mount`로 그림). 화면 흐름은 Playwright E2E(`getByRole` 사용), 접근성은 `@axe-core/playwright`(`tests/e2e/a11y.spec.ts`)로 검사합니다.
- 버그를 고치면 고치기 전에 실패하는 테스트를 함께 넣습니다.

## 5. 코드 스타일

- **TypeScript strict**(`nuxt.config.ts`의 `typescript.strict: true`, `pnpm typecheck`는 `nuxt typecheck`)를 유지합니다. `any`·`as` 단언·`@ts-ignore`는 피합니다.
- 코드 모양: Prettier·Biome 설정이 없습니다. ESLint(`@nuxt/eslint`)와 기존 코드 형식을 따릅니다.
- 시뮬레이션은 시간의 순수 함수로 둡니다. 어느 서버 인스턴스든 같은 시각에 같은 상태를 내야 합니다(서버리스).
- 3D는 화면에 다가올 때 받고, 지도 도형은 웹 워커에서 만들며, three.js를 첫 로딩에 넣지 않습니다.
- 접근성은 **WCAG 2.2와 KWCAG 2.2**를 따릅니다. 자동 검사는 Playwright의 axe(WCAG 2.2 AA 태그)뿐이고, Vue라 jsx-a11y 같은 접근성 린트 규칙과 Storybook axe 애드온은 없습니다(표준과 다른 점):
  - 네이티브 요소를 먼저 씁니다(`<button type="button">`, `<a href>`, `<dialog>`).
  - 텍스트 대비 4.5:1 이상, 모든 기능은 키보드로 되고 초점 표시를 지우지 않습니다. 조작 크기 24×24px 이상입니다.
  - 입력칸마다 레이블, 오류는 `aria-invalid`·`aria-describedby`로 연결합니다.
  - 새 문제는 `role="status"`(위험은 `role="alert"`)로 알리고, 상태는 색·모양·글자를 함께 씁니다. 3D 지도에는 표 대체 콘텐츠를 둡니다.
  - 애니메이션 정지와 `prefers-reduced-motion`을 지킵니다. axe를 통과해도 새 화면은 키보드·화면 낭독기·정지 기능을 직접 확인합니다.

## 6. Git·PR

- 흐름은 **GitHub Flow**입니다. `main`에 직접 커밋·푸시하지 않고, 최신 `main`에서 브랜치를 만들어 PR로만 병합합니다.
- 브랜치 이름: `feat/…`, `fix/…`, `refactor/…`, `docs/…`, `test/…`, `chore/…`, `release/…`.
- 커밋·PR 제목은 **Conventional Commits**(`<타입>: <한국어 요약>`)입니다. 타입은 `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `chore`, `ci`, `build`입니다. 이 저장소는 `release`, `security` 타입도 썼습니다. 실제 예: `feat: 오프라인 마지막 상태·탈것 화면 미리 저장·회원 첫 화면 1.2.0`, `security: 보안 헤더·서버 세션·로그인 시도 제한 0.16.0`. 이 저장소는 버전을 괄호 없이 끝에 붙여 왔습니다(표준의 끝 `(x.y.z)`와 다른 점, 0.12.0까지는 타입 없이 `… (0.12.0)`처럼 괄호를 썼음).
- **기여자는 ryushin01만 남깁니다.** 커밋 작성자는 항상 ryushin01(`ryushin0 <141554987+ryushin01@users.noreply.github.com>`)입니다. 이 저장소는 백엔드 코드가 있는 저장소라 공동 작성자 줄은 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 하나만 넣습니다.
- GitHub Actions가 커밋하는 워크플로는 작성자를 ryushin01로 설정합니다(`github-actions[bot]` 금지). Dependabot PR은 그대로 병합하지 말고 같은 변경을 ryushin01 커밋으로 다시 만들어 병합합니다.
- **Semantic Versioning**(주.부.수): 기능·수정 PR은 `package.json`의 `version`, README 버전 배지, README의 '프로젝트 상태' 줄을 함께 올리고 `CHANGELOG.md`에 절을 더합니다. 머리 줄은 이 파일의 기존 형식 `## x.y.z — YYYY-MM-DD`, 내용은 소제목 없이 `-` 목록입니다(표준의 `-`·추가·변경·수정·제거와 다른 점). 문서만 바뀐 PR은 보통 버전을 올리지 않습니다.
- **Keep a Changelog**를 따르되, 이 저장소는 `[Unreleased]` 절을 쓰지 않고 PR마다 바로 버전 절을 더합니다(표준과 다른 점).
- 병합은 squash(`… (#번호)`)로 합니다. 원격 브랜치 삭제는 저장소 설정에 맡깁니다.
- CI가 통과하면 CodeRabbit 리뷰를 기다리지 않고 병합합니다. 이미 달린 지적 중 맞는 것은 반영합니다. Actions가 돌지 않으면 4절의 검사를 로컬에서 통과한 뒤 병합합니다.

## 7. 배포·릴리스

- Vercel 프로젝트 `kao` 하나에 화면(Nuxt SSR)과 `/api` 함수(싱가포르 `sin1`)를 올립니다. 빌드는 `vercel-build`(`node scripts/migrate.mjs && nuxt build`)로 운영 DB 스키마를 적용합니다.
- `vercel.json`의 `git.deploymentEnabled`로 `main`만 배포합니다. 문서만 바뀐 커밋도 건너뛰지 않고 배포되므로, 사용자가 일괄 배포일을 정하면 그때까지 병합하지 않고 PR만 올려 둡니다(Vercel Hobby 하루 100회는 계정 전체 한도).
- Neon 연동은 운영 환경에만 있습니다. 운영 데모 계정·탈것은 `scripts/migrate.mjs`가 맞춥니다.
- 5분 위험 알림은 Cloudflare Workers 크론(`workers/notify-cron`)이 부르고, `.github/workflows/notify.yml`은 손으로 한 번 부를 때만 씁니다.
- 릴리스: 병합 뒤 `vX.Y.Z` 태그와 같은 이름의 GitHub 릴리스(대상은 병합 커밋 전체 SHA, 본문은 `CHANGELOG.md`의 해당 절)를 만듭니다.
- 배포 뒤 운영 배포가 병합 커밋에서 READY인지, 운영 주소가 200인지 확인합니다([배포](docs/deploy.md#배포된-사이트-확인)).
- 릴리스 뒤 `bash ~/Documents/Archive/Backup/backup.sh`를 돌려 DONE을 확인합니다.
- 보관함 계획 문서 `~/Documents/Obsidian Vault/KAO v1.0.0 고도화 계획.md`에 날짜와 진행 기록을 남깁니다.
- 소개가 크게 바뀌면 프로필 저장소 `ryushin01/ryushin01` README의 프로젝트 표를 고칩니다(버전 숫자는 자동 갱신).

## 8. 보안·주의사항

- 비밀값과 `.env.local`, `.env.cron.local`, `.env.ingest.local`을 커밋하지 않습니다. 비밀은 Vercel에 읽을 수 없는 Secret으로 넣습니다.
- `CRON_SECRET`은 Vercel·GitHub 저장소 비밀·Cloudflare 워커 비밀 세 곳이 같아야 합니다. 바꿀 때는 [배포](docs/deploy.md)의 이어 실행 명령으로 세 곳을 함께 바꿉니다.
- 보안 헤더, 서버 세션(scrypt, 서명 쿠키), 로그인 시도 제한(15분 창)을 유지합니다. 운영에 `SESSION_SECRET`이 없으면 서버가 시작하지 않습니다.
- 실차 장치는 탈것 하나에 묶인 장치 토큰(`pnpm device add`)을 씁니다.
- 공개 데모에 유료 API 키를 넣지 않습니다. 회원·등록번호·주행 기록은 가상 데이터로만 둡니다.
- 3D 모델·지도 데이터의 출처(CC BY 4.0, ODbL)를 README 출처 표와 화면에 유지합니다.
- CI·배포·릴리스 상태는 명령 결과(`gh run`, Vercel API, `curl`)로 확인한 것만 말합니다.
- 먼저 묻기: 새 런타임 의존성 추가, 빌드·배포 설정(`nuxt.config.ts`, `vercel.json`, `vercel-build`) 변경, 운영 DB를 바꾸는 명령(`pnpm db:migrate`, `pnpm device`) 실행.
- 절대 금지: 비밀값을 `NUXT_PUBLIC_*`·`runtimeConfig.public`에 넣기, `.env*` 커밋, `eslint-disable`·`--no-verify`로 검사 우회, `main` 직접 푸시.

## 9. 공통 규칙

공통 규칙은 `~/Documents/GitHub/CLAUDE.md`에 있습니다(충돌하면 이 파일이 우선). 핵심:

- 답변·커밋·PR·문서·주석은 한국어로 씁니다.
- 허락을 묻지 않고 끝까지 진행한 뒤 결과를 한 번에 보고합니다. 비용·비밀값 생성·디자인 변경·되돌릴 수 없는 공개 행동은 진행하지 않고 보고합니다.
- 사용자의 진행 중인 작업을 보호합니다. 로컬 작업 트리에 변경이 있으면 `git worktree add /tmp/<이름> -b <브랜치> origin/main`에서 작업하고 끝나면 지웁니다.
- 다른 세션에 공지할 때는 Paseo의 ryushin01 그룹 세션에만 보냅니다.
