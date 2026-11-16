/**
 * 오래된 기록을 지우는 기준(ms). 배포 빌드(scripts/migrate.mjs)와 알림 크론(하루 한 번, /api/cron/notify)이 지웁니다.
 * 스크립트가 이 파일을 그대로 불러오므로 런타임 의존이 없어야 합니다.
 */
export const RETENTION = {
  /** 실차 측정값(지표 이력은 최근 60분만 씀) */
  readings: 86_400_000,
  /** 로그인 시도 카운터(창이 시작된 뒤 하루. 시도 제한은 15분 창만 봄) */
  loginAttempts: 86_400_000,
  /** 원격 조치와 차량 응답 */
  actions: 7 * 86_400_000,
  /** 해결한 실측 문제 */
  liveIssues: 7 * 86_400_000,
  /** 보낸 알림 기록 */
  deliveries: 7 * 86_400_000,
} as const

const KST_OFFSET = 9 * 3600_000
/** 알림 크론이 기록을 지우는 때: 한국 시간 4시부터 10분(5분 크론이 두 번 지나감, 지우기는 여러 번 해도 같음) */
export function isPruneWindow(now: number) {
  const time = (((now + KST_OFFSET) % 86_400_000) + 86_400_000) % 86_400_000
  return time >= 4 * 3600_000 && time < 4 * 3600_000 + 10 * 60_000
}
