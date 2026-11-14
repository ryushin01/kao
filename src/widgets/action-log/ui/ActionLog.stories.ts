import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { ActionLogEntry } from '@shared/api'
import ActionLog from './ActionLog.vue'

const at = Date.UTC(2026, 10, 14, 4, 30, 0)
const base = { vehicleId: 'kao-0001', issueId: 'live-kao-0001-coolant-1', action: 'cooling-mode' } as const

/** 가상 기록: 시뮬레이션 조치의 전송·완료와 실차 명령의 실패·응답 없음 */
const entries: ActionLogEntry[] = [
  { ...base, id: 'e4', at: at + 125_000, phase: 'failed', message: 'G80 · 냉각수 과열: 냉각 모드 명령에 2분 동안 차량 응답 없음' },
  { ...base, id: 'e3', at: at + 9_000, phase: 'failed', message: 'G80 · 냉각수 과열: 출력 제한 차량 적용 실패 — 주행 중에는 바꿀 수 없음', action: 'power-limit' },
  { ...base, id: 'e2', at: at + 2_400, phase: 'completed', message: 'G80 · 냉각수 과열: 냉각 모드 완료' },
  { ...base, id: 'e1', at, phase: 'sent', message: 'G80 · 냉각수 과열: 냉각 모드 명령 전송' },
]

const meta = { title: 'widgets/action-log/ActionLog', component: ActionLog, args: { entries } } satisfies Meta<typeof ActionLog>

export default meta
type Story = StoryObj<typeof meta>

export const WithFailures: Story = {}
export const Empty: Story = { args: { entries: [] } }
