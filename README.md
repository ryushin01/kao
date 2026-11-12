# KAO — Kinetic Aero One

[![CI](https://github.com/ryushin01/kao/actions/workflows/ci.yml/badge.svg)](https://github.com/ryushin01/kao/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-0.2.0-8B0000)

회원의 자동차·모터사이클·자전거가 달리는 동안 상태를 실시간으로 지켜보고, 문제가 생기면 원격으로 조치하는 관제 서비스입니다. 등록된 탈것은 실제 모양을 본뜬 3D 미니어처로 지도 위를 달립니다.

> **프로젝트 상태:** 포트폴리오 프로젝트입니다. 차량과 연결하는 대신 서버의 주행 시뮬레이션이 데이터를 만들며, 회원·등록번호·주행 기록은 모두 가상 데이터입니다.

## 화면

| 소개 | 관제 센터 |
|---|---|
| ![붉은 강착 원반이 도는 블랙홀 앞에 "돌이킬 수 없는 지점에 닿기 전에" 제목이 있는 첫 화면](docs/images/home.jpg) | ![경로 4개 위를 미니어처가 달리는 3D 관제 지도와 주행 위치 표](docs/images/fleet.jpg) |

| 탈것 상세 | 미니어처 |
|---|---|
| ![로소 마스 색 아벤타도르 3D 모델이 놓인 턴테이블과 문제·원격 조치 패널](docs/images/vehicle.jpg) | ![모델 고르기와 제원 옆에 놓인 파니갈레 V4 S 미니어처](docs/images/miniature.jpg) |

| 모바일 관제 센터 |
|---|
| <img src="docs/images/mobile.jpg" alt="모바일 화면의 수신 상태·조치 필요 건수 요약과 카메라 시점 버튼" width="240"> |

## 주요 기능

| 화면 | 내용 |
|---|---|
| 소개 | 스크롤할수록 블랙홀(사건의 지평선)에 다가가는 WebGL 셰이더 배경, 관측·감지·조치·미니어처 4개 챕터 |
| 관제 센터 | SSE로 0.5초마다 받는 주행 데이터, 3D 미니어처 관제 지도(시점 고르기·따라가기), 주행 위치 표, 위험 등급순 조치 대기열, 원격 조치 기록 |
| 탈것 상세 | 턴테이블 미니어처, 실시간 지표와 경고·위험 기준, 문제별 원격 조치, 경로 위치 |

- **미니어처**: G80·아벤타도르·파니갈레는 실제 3D 모델(아래 출처)을 실제 치수와 방향으로 맞추고 바퀴를 분리해 썼고, STRiDA LT는 Three.js로 직접 모델링했습니다. 바퀴는 속도에 맞춰 구르고, 이륜차는 코너에서 기울기 값만큼 눕습니다. 도장 색은 회원 데이터대로 바뀝니다.
- **원격 조치**: 냉각 모드, 출력·속도 제한, TPMS 재보정, 트랙션 강화, 절전 모드, 운전자 알림, 긴급 출동. 확인 대화상자를 거치고 두 번 눌러도 한 번만 보냅니다.
- **접근성**: 본문 바로가기, 애니메이션 정지(운영체제 '동작 줄이기' 따름), 색·모양·글자를 함께 쓰는 상태 표시, 새 문제를 `status`·`alert`로 알림, 3D 지도의 표 대체 콘텐츠

## 기술 스택

![Nuxt, Vue, Three.js, TypeScript, pnpm, Vitest, GitHub Actions](https://skillicons.dev/icons?i=nuxtjs,vue,threejs,ts,pnpm,vitest,githubactions)

| 구분 | 사용 기술 |
|---|---|
| 프레임워크 | Nuxt 4, Vue 3, TypeScript 6 |
| 3D | Three.js(직접 모델링한 미니어처, GLSL 블랙홀 셰이더, OrbitControls) |
| 서버 | Nitro(h3) API, Server-Sent Events, 시드 기반 주행 시뮬레이션 |
| 구조 | Feature-Sliced Design v2.1, Steiger |
| 품질 | ESLint(@nuxt/eslint), Vitest + Vue Test Utils(happy-dom), Storybook 10, Playwright + axe |
| CI | GitHub Actions |

## 시작하기

Node.js 24(`.nvmrc`)와 pnpm 12가 필요합니다.

```bash
corepack enable pnpm
pnpm install
pnpm dev        # http://localhost:3000
```

| 명령 | 설명 |
|---|---|
| `pnpm build` / `pnpm preview` | 프로덕션 빌드 / 빌드 결과 실행 |
| `pnpm lint` / `pnpm lint:fsd` / `pnpm typecheck` | ESLint / Steiger(FSD) / 타입 검사 |
| `pnpm test` | 단위·컴포넌트 테스트 |
| `pnpm test:e2e` | 프로덕션 빌드의 E2E·접근성 검사 (먼저 `build` 필요) |
| `pnpm storybook` | Storybook (`http://localhost:6006`) |
| `pnpm build:models` | `assets-src/`의 Sketchfab 원본을 `public/models/*.glb`로 변환 |

## 프로젝트 구조

```
app/              Nuxt 라우트·진입점 (src를 다시 내보내기만 함)
server/           Nitro API와 주행 시뮬레이션
scripts/          3D 모델 변환 스크립트
public/models/    변환한 3D 모델(GLB)
src/
├─ app/           진입 컴포넌트, 전역 스타일
├─ pages/         소개, 관제 센터, 탈것 상세, 오류
├─ widgets/       관제 지도, 미니어처 전시, 블랙홀 배경, 헤더 등
├─ features/      원격 조치
├─ entities/      탈것(미니어처 3D 모델, 실시간 스트림, 지표 UI)
└─ shared/        API 계약, 경로 좌표, Three.js 무대, 기본 UI
tests/e2e/        Playwright E2E
```

## 3D 모델 출처

| 모델 | 원작자 | 라이선스 |
|---|---|---|
| [Genesis G80](https://sketchfab.com/3d-models/genesis-g80-e9abf10cfee04ea480951d3c2f71f060) | [Nieve5677](https://sketchfab.com/niev) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [2022 Lamborghini Aventador LP780-4 Ultimae](https://sketchfab.com/3d-models/2022-lamborghini-aventador-lp780-4-ultimae-714a8795e58442258f96bd364b9096b1) | [Ddiaz Design](https://sketchfab.com/ddiaz-design) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Ducati Panigale V4](https://sketchfab.com/3d-models/ducati-panigale-v4-47f87e3d70f644289e34cbff91255d0c) | [ROY](https://sketchfab.com/roy.gearloft.in) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

크기·방향 조정, 바퀴 분리, 도장 색 변경, 압축을 거쳤습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [개발 가이드](docs/development.md) | 구조, API와 시뮬레이션, 미니어처 모델링, 테스트, CI |
| [버전 기록](CHANGELOG.md) | 버전별 변경 내용 |
