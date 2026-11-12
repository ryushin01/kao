# 버전 기록

## 0.1.0 — 2026-11-12

처음 공개한 버전입니다.

- 소개 화면: 스크롤할수록 블랙홀에 다가가는 WebGL 배경과 관측·감지·조치·미니어처 4개 챕터
- 관제 센터: SSE로 0.5초마다 받는 4대의 주행 데이터, 3D 미니어처 관제 지도(시점 고르기, 따라가기), 주행 위치 표, 조치 대기열, 원격 조치 기록
- 탈것 상세: 턴테이블 미니어처, 실시간 지표(경고·위험 기준), 문제별 원격 조치, 경로 위치
- 미니어처: Genesis G80, Lamborghini Aventador LP 780-4 Ultimae, Ducati Panigale V4 S, STRiDA LT를 실제 치수 비율로 Three.js에서 직접 모델링
- 원격 조치: 확인 대화상자, 중복 전송 잠금, 조치 중 → 해결 흐름
- 접근성: 본문 바로가기, 애니메이션 정지, 색과 글자를 함께 쓰는 상태 표시, 새 문제 알림(`status`·`alert`), 3D 지도의 표 대체 콘텐츠
- 품질: Vitest 단위 테스트, Storybook 스토리, Playwright E2E(axe 접근성·가로 넘침), Steiger FSD 검사, GitHub Actions CI
