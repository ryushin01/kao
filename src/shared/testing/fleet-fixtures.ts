import type { Issue, MetricReading, VehicleSnapshot } from '../api'

/** 테스트와 스토리에서 쓰는 가상 데이터 */
export const metricFixture: MetricReading = {
  key: 'coolant',
  label: '냉각수 온도',
  unit: '°C',
  value: 108.4,
  min: 40,
  max: 130,
  warn: 105,
  crit: 115,
  direction: 'high',
  precision: 1,
  state: 'warning',
}

export const issueFixture: Issue = {
  id: 'kao-0001-coolant-1',
  vehicleId: 'kao-0001',
  metricKey: 'coolant',
  severity: 'warning',
  title: '냉각수 과열',
  detail: '냉각수 온도가 기준을 넘었습니다. 라디에이터 팬이나 수온 조절기 이상일 수 있습니다.',
  detectedAt: Date.UTC(2026, 10, 12, 11, 30, 0),
  status: 'open',
  actions: ['cooling-mode', 'power-limit', 'dispatch-service'],
}

export const vehicleFixture: VehicleSnapshot = {
  id: 'kao-0001',
  modelId: 'genesis-g80',
  kind: 'sedan',
  maker: 'Genesis',
  model: 'G80',
  year: 2025,
  plate: 'K-0001',
  member: '가상 회원 01',
  paint: { name: 'Uyuni White', hex: '#e9e6df' },
  routeId: 'urban-loop',
  progress: 0.42,
  lap: 3,
  speed: 72,
  speedCap: null,
  health: 'warning',
  metrics: [metricFixture],
  issues: [issueFixture],
}
