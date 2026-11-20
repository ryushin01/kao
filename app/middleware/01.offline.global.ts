// 화면 접근 규칙(auth.global)보다 먼저 돕니다. 오프라인이면 세션을 묻지 않고 저장한 화면을 엽니다.
export { default } from '@app/routes/offline-guard'
