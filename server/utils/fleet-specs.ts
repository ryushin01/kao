import type { ActionCode, VehicleKind, VehicleModelId } from '../../src/shared/api/contract'
import type { Handling } from './sim/drive'

export interface DeriveContext {
  speed: number
  progress: number
  elapsed: number
  /** 지금 위치에서 경로가 굽은 정도(1/m, 0 이상). 직선이면 0 */
  curvature: number
}

export interface FaultSpec {
  /** 문제가 커질 때 지표가 향하는 값 */
  target: number
  /** 초당 변화량(절댓값) */
  rate: number
  title: string
  detail: string
  actions: ActionCode[]
}

export interface MetricSpec {
  key: string
  label: string
  unit: string
  min: number
  max: number
  nominal: number
  noise: number
  warn: number | null
  crit: number | null
  direction: 'high' | 'low'
  precision: number
  derive?: (ctx: DeriveContext) => number
  /** derive로 늘 출렁이는 지표에서 문제를 감지할 때 기준으로 삼는 평소 값 */
  baseline?: number
  fault?: FaultSpec
}

export interface VehicleSpec {
  id: string
  modelId: VehicleModelId
  kind: VehicleKind
  maker: string
  model: string
  year: number
  plate: string
  member: string
  paint: { name: string; hex: string }
  routeId: string
  /**
   * 순항 속도 범위(km/h). 최고 속도는 이 탈것이 경로에서 내는 상한이고(제한속도가 더 높아도 넘지 않음), 속도·출력 제한
   * 조치의 기준입니다: 도심 50(안전속도 5030), 강변북로·올림픽대로 80, 남산 50, 자전거 20. 최저 속도는 데모 장치가 씁니다.
   */
  cruise: readonly [number, number]
  /** 주행 속도 표(제한속도·굽이·신호)의 몇 배로 달리는지(교통 흐름). 시간에 따라 이 범위에서 천천히 오갑니다. */
  pace: readonly [number, number]
  /** 가속·감속·굽은 길에서 견디는 횡가속(m/s²) */
  handling: Handling
  metrics: MetricSpec[]
}

const speedMetric = (max: number): MetricSpec => ({
  key: 'speed', label: '속도', unit: 'km/h', min: 0, max, nominal: 0, noise: 0,
  warn: null, crit: null, direction: 'high', precision: 0,
  derive: ({ speed }) => speed,
})

const tirePressure = (
  key: string, label: string, nominal: number, warn: number, crit: number, target: number,
  actions: ActionCode[], max = 300,
): MetricSpec => ({
  key, label, unit: 'kPa', min: 150, max, nominal, noise: 0.8, warn, crit, direction: 'low', precision: 0,
  fault: {
    target, rate: 1.6, actions,
    title: `${label} 저하`,
    detail: '공기압이 계속 떨어지고 있습니다. 펑크나 밸브 누설일 수 있습니다.',
  },
})

/**
 * 가상 회원의 등록 탈것입니다. 분류(VEHICLE_CATEGORIES)마다 대표 모델 한 대씩, 모두 관제 지도에서 실제 도로를 달립니다
 * (분류를 더하면 이 목록·경로·회원 계정도 함께 더합니다. fleet-specs.test.ts가 확인합니다). 회원 정보와 등록번호는 모두 가상 값입니다.
 */
export const VEHICLE_SPECS: VehicleSpec[] = [
  {
    id: 'kao-0001',
    modelId: 'genesis-g80',
    kind: 'sedan',
    maker: 'Genesis',
    model: 'G80',
    year: 2025,
    plate: 'K-0001',
    member: '가상 회원 01',
    paint: { name: 'Vik Black', hex: '#0e0f11' },
    routeId: 'downtown',
    cruise: [15, 50],
    pace: [0.7, 1],
    handling: { accel: 1.6, decel: 2.5, lateral: 2 },
    metrics: [
      speedMetric(240),
      {
        key: 'rpm', label: '엔진 회전수', unit: 'rpm', min: 0, max: 7000, nominal: 0, noise: 25,
        warn: null, crit: null, direction: 'high', precision: 0,
        derive: ({ speed }) => 780 + speed * 21,
      },
      {
        key: 'coolant', label: '냉각수 온도', unit: '°C', min: 40, max: 130, nominal: 90, noise: 0.4,
        warn: 105, crit: 115, direction: 'high', precision: 1,
        fault: {
          target: 121, rate: 0.9, actions: ['cooling-mode', 'power-limit', 'dispatch-service'],
          title: '냉각수 과열',
          detail: '냉각수 온도가 기준을 넘었습니다. 라디에이터 팬이나 수온 조절기 이상일 수 있습니다.',
        },
      },
      tirePressure('tire-fl', '앞왼쪽 타이어 공기압', 250, 220, 200, 186, ['speed-limit', 'tpms-recalibrate', 'dispatch-service']),
      {
        key: 'battery', label: '12V 배터리 전압', unit: 'V', min: 10, max: 15, nominal: 14.2, noise: 0.02,
        warn: 12.4, crit: 12, direction: 'low', precision: 2,
        fault: {
          target: 11.6, rate: 0.05, actions: ['eco-power', 'dispatch-service'],
          title: '12V 배터리 전압 저하',
          detail: '발전기 충전량이 모자랍니다. 계속 달리면 전자 장비가 꺼질 수 있습니다.',
        },
      },
    ],
  },
  {
    id: 'kao-0002',
    modelId: 'lamborghini-aventador',
    kind: 'supercar',
    maker: 'Lamborghini',
    model: 'Aventador LP 780-4 Ultimae',
    year: 2022,
    plate: 'K-0002',
    member: '가상 회원 02',
    paint: { name: 'Rosso Mars', hex: '#a3141c' },
    routeId: 'han-river',
    cruise: [45, 80],
    pace: [0.8, 1],
    handling: { accel: 2.5, decel: 3, lateral: 2.6 },
    metrics: [
      speedMetric(355),
      {
        key: 'rpm', label: '엔진 회전수', unit: 'rpm', min: 0, max: 8700, nominal: 0, noise: 40,
        warn: null, crit: null, direction: 'high', precision: 0,
        derive: ({ speed }) => 950 + speed * 31,
      },
      {
        key: 'oil', label: '엔진오일 온도', unit: '°C', min: 60, max: 160, nominal: 112, noise: 0.5,
        warn: 130, crit: 145, direction: 'high', precision: 1,
        fault: {
          target: 151, rate: 1.1, actions: ['cooling-mode', 'power-limit', 'notify-rider'],
          title: '엔진오일 과열',
          detail: '고속 주행이 이어져 오일 온도가 기준을 넘었습니다. V12 엔진 보호가 필요합니다.',
        },
      },
      {
        key: 'brake-fl', label: '앞왼쪽 브레이크 디스크 온도', unit: '°C', min: 100, max: 1000, nominal: 380, noise: 6,
        warn: 650, crit: 800, direction: 'high', precision: 0,
        fault: {
          target: 860, rate: 14, actions: ['power-limit', 'notify-rider'],
          title: '브레이크 과열',
          detail: '카본 세라믹 디스크 온도가 높습니다. 제동력이 떨어지는 페이드 현상이 생길 수 있습니다.',
        },
      },
      tirePressure('tire-rl', '뒤왼쪽 타이어 공기압', 230, 205, 185, 176, ['speed-limit', 'tpms-recalibrate', 'dispatch-service']),
    ],
  },
  {
    id: 'kao-0003',
    modelId: 'ducati-panigale-v4s',
    kind: 'superbike',
    maker: 'Ducati',
    model: 'Panigale V4 S',
    year: 2025,
    plate: 'K-0003',
    member: '가상 회원 03',
    paint: { name: 'Ducati Red', hex: '#b5121b' },
    routeId: 'namsan',
    cruise: [20, 50],
    pace: [0.75, 1],
    handling: { accel: 2.5, decel: 3, lateral: 2.6 },
    metrics: [
      speedMetric(300),
      {
        key: 'rpm', label: '엔진 회전수', unit: 'rpm', min: 0, max: 16500, nominal: 0, noise: 60,
        warn: null, crit: null, direction: 'high', precision: 0,
        derive: ({ speed }) => 1300 + speed * 52,
      },
      {
        // 굽은 길을 도는 기울기 atan(v²κ/g). 급한 굽이에서는 속도를 줄인다고 보고 35°에서 멈춥니다(평소에는 경고 기준 아래).
        key: 'lean', label: '기울기 각도', unit: '°', min: 0, max: 65, nominal: 0, noise: 0.6,
        warn: 42, crit: 50, direction: 'high', precision: 1, baseline: 25,
        derive: ({ speed, curvature }) => Math.min(35, (Math.atan(((speed / 3.6) ** 2 * curvature) / 9.81) * 180) / Math.PI),
        fault: {
          target: 30, rate: 0.7, actions: ['traction-boost', 'notify-rider'],
          title: '과도한 기울기',
          detail: '코너마다 접지 한계에 가까운 기울기가 반복됩니다. 미끄러질 위험이 큽니다.',
        },
      },
      {
        key: 'coolant', label: '냉각수 온도', unit: '°C', min: 40, max: 130, nominal: 88, noise: 0.4,
        warn: 105, crit: 112, direction: 'high', precision: 1,
        fault: {
          target: 118, rate: 0.8, actions: ['cooling-mode', 'power-limit'],
          title: '냉각수 과열',
          detail: '서킷 주행으로 냉각수 온도가 올랐습니다. 데스모세디치 스트라달레 엔진 보호가 필요합니다.',
        },
      },
      tirePressure('tire-r', '뒤 타이어 공기압', 250, 225, 205, 196, ['speed-limit', 'notify-rider', 'dispatch-service']),
    ],
  },
  {
    id: 'kao-0004',
    modelId: 'strida-lt',
    kind: 'bicycle',
    maker: 'STRiDA',
    model: 'LT',
    year: 2024,
    plate: 'K-0004',
    member: '가상 회원 04',
    paint: { name: 'Aluminium', hex: '#c9ccd1' },
    routeId: 'yeouido',
    cruise: [10, 20],
    pace: [0.65, 1],
    handling: { accel: 0.7, decel: 1.2, lateral: 1.2 },
    metrics: [
      speedMetric(40),
      {
        key: 'cadence', label: '페달 회전수', unit: 'rpm', min: 0, max: 120, nominal: 0, noise: 1.2,
        warn: null, crit: null, direction: 'high', precision: 0,
        derive: ({ speed }) => speed * 3.9,
      },
      tirePressure('tire-f', '앞 타이어 공기압', 345, 290, 250, 232, ['notify-rider', 'dispatch-service'], 450),
      {
        key: 'belt', label: '구동 벨트 장력', unit: '%', min: 0, max: 120, nominal: 100, noise: 0.3,
        warn: 82, crit: 70, direction: 'low', precision: 0,
        fault: {
          target: 64, rate: 0.6, actions: ['notify-rider', 'dispatch-service'],
          title: '구동 벨트 장력 저하',
          detail: '벨트가 늘어나 페달을 밟을 때 미끄러질 수 있습니다.',
        },
      },
      {
        key: 'tracker', label: '트래커 배터리', unit: '%', min: 0, max: 100, nominal: 78, noise: 0.1,
        warn: 25, crit: 12, direction: 'low', precision: 0,
        fault: {
          target: 8, rate: 1.4, actions: ['eco-power', 'notify-rider'],
          title: '트래커 배터리 부족',
          detail: '위치 추적기 배터리가 곧 바닥납니다. 꺼지면 주행을 지켜볼 수 없습니다.',
        },
      },
    ],
  },
  {
    id: 'kao-0005',
    modelId: 'genesis-essentia',
    kind: 'ev',
    maker: 'Genesis',
    model: 'Essentia Concept',
    year: 2018,
    plate: 'K-0005',
    member: '가상 회원 05',
    paint: { name: 'Gunmetal Grey', hex: '#4a4c52' },
    routeId: 'mapo-wonhyo',
    // 강변북로(80)와 마포대교·원효대교를 오갑니다.
    cruise: [35, 80],
    pace: [0.8, 1],
    // 전기 모터라 출발이 빠르고, 배터리가 바닥에 깔려 무게 중심이 낮습니다.
    handling: { accel: 2.8, decel: 3, lateral: 2.6 },
    metrics: [
      speedMetric(250),
      {
        key: 'motor-power', label: '모터 출력', unit: 'kW', min: 0, max: 600, nominal: 0, noise: 1.5,
        warn: null, crit: null, direction: 'high', precision: 0,
        // 공기 저항이 속도의 세제곱으로 늘어 정속 주행 출력도 따라 늘어납니다(시속 80km에 약 24kW).
        derive: ({ speed }) => 3 + speed ** 3 * 4e-5,
      },
      {
        key: 'battery-temp', label: '고전압 배터리 온도', unit: '°C', min: -10, max: 80, nominal: 32, noise: 0.15,
        warn: 45, crit: 55, direction: 'high', precision: 1,
        fault: {
          target: 60, rate: 0.55, actions: ['cooling-mode', 'power-limit', 'dispatch-service'],
          title: '고전압 배터리 과열',
          detail: '배터리 셀 온도가 기준을 넘었습니다. 냉각수 펌프나 셀 이상일 수 있어, 열 폭주를 막으려면 출력을 낮춰야 합니다.',
        },
      },
      {
        key: 'motor-temp', label: '구동 모터 온도', unit: '°C', min: 20, max: 180, nominal: 75, noise: 0.5,
        warn: 120, crit: 140, direction: 'high', precision: 1,
        fault: {
          target: 150, rate: 1.8, actions: ['cooling-mode', 'power-limit', 'notify-rider'],
          title: '구동 모터 과열',
          detail: '고속 주행이 이어져 모터 권선 온도가 올랐습니다. 영구 자석이 약해지기 전에 식혀야 합니다.',
        },
      },
      {
        key: 'soc', label: '배터리 잔량', unit: '%', min: 0, max: 100, nominal: 46, noise: 0.05,
        warn: 20, crit: 10, direction: 'low', precision: 0,
        fault: {
          target: 6, rate: 1.2, actions: ['eco-power', 'notify-rider', 'dispatch-service'],
          title: '배터리 잔량 급감',
          detail: '달린 거리보다 배터리가 빨리 줄고 있습니다. 셀 이상이나 과도한 소모일 수 있어 충전소 안내가 필요합니다.',
        },
      },
      tirePressure('tire-fr', '앞오른쪽 타이어 공기압', 260, 230, 210, 196, ['speed-limit', 'tpms-recalibrate', 'dispatch-service']),
    ],
  },
  {
    id: 'kao-0006',
    modelId: 'renault-arkana',
    kind: 'suv',
    maker: 'Renault',
    model: 'Arkana',
    year: 2024,
    plate: 'K-0006',
    member: '가상 회원 06',
    paint: { name: 'Glacier White', hex: '#e8e8e5' },
    routeId: 'yongsan-park',
    // 녹사평대로·서빙고로에 60 구간이 있습니다.
    cruise: [20, 60],
    pace: [0.7, 1],
    // 지상고가 높아 무게 중심이 높습니다.
    handling: { accel: 1.8, decel: 2.6, lateral: 2.1 },
    metrics: [
      speedMetric(195),
      {
        key: 'rpm', label: '엔진 회전수', unit: 'rpm', min: 0, max: 6500, nominal: 0, noise: 25,
        warn: null, crit: null, direction: 'high', precision: 0,
        derive: ({ speed }) => 800 + speed * 26,
      },
      {
        key: 'cvt', label: '변속기 오일 온도', unit: '°C', min: 20, max: 150, nominal: 82, noise: 0.4,
        warn: 110, crit: 120, direction: 'high', precision: 1,
        fault: {
          target: 126, rate: 1.2, actions: ['power-limit', 'notify-rider', 'dispatch-service'],
          title: '변속기 과열',
          detail: '오르막과 정체가 이어져 CVT 오일 온도가 올랐습니다. 벨트가 미끄러지기 전에 부하를 줄여야 합니다.',
        },
      },
      {
        key: 'oil-pressure', label: '엔진오일 압력', unit: 'kPa', min: 0, max: 600, nominal: 320, noise: 2,
        warn: 150, crit: 100, direction: 'low', precision: 0,
        fault: {
          target: 80, rate: 7, actions: ['power-limit', 'dispatch-service'],
          title: '엔진오일 압력 저하',
          detail: '오일이 새거나 펌프에 이상이 있을 수 있습니다. 계속 달리면 엔진이 손상됩니다.',
        },
      },
      tirePressure('tire-rr', '뒤오른쪽 타이어 공기압', 250, 220, 200, 186, ['speed-limit', 'tpms-recalibrate', 'dispatch-service']),
    ],
  },
  {
    id: 'kao-0007',
    modelId: 'toyota-alphard',
    kind: 'mpv',
    maker: 'Toyota',
    model: 'Alphard',
    year: 2025,
    plate: 'K-0007',
    member: '가상 회원 07',
    paint: { name: 'Black', hex: '#0d0d0f' },
    routeId: 'seoul-station',
    cruise: [15, 50],
    pace: [0.7, 1],
    // 무겁고 뒷좌석 승객이 편하도록 부드럽게 가감속합니다.
    handling: { accel: 1.3, decel: 2.2, lateral: 1.8 },
    metrics: [
      speedMetric(180),
      {
        key: 'rpm', label: '엔진 회전수', unit: 'rpm', min: 0, max: 6000, nominal: 0, noise: 20,
        warn: null, crit: null, direction: 'high', precision: 0,
        derive: ({ speed }) => 700 + speed * 22,
      },
      {
        key: 'hv-battery', label: '하이브리드 배터리 온도', unit: '°C', min: -10, max: 80, nominal: 31, noise: 0.15,
        warn: 45, crit: 52, direction: 'high', precision: 1,
        fault: {
          target: 57, rate: 0.6, actions: ['cooling-mode', 'eco-power', 'dispatch-service'],
          title: '하이브리드 배터리 과열',
          detail: '정체 구간에서 모터만으로 오래 달려 배터리 온도가 올랐습니다. 냉각 팬 흡입구가 막혔을 수 있습니다.',
        },
      },
      {
        key: 'cabin-co2', label: '실내 이산화탄소', unit: 'ppm', min: 400, max: 5000, nominal: 750, noise: 8,
        warn: 1500, crit: 2500, direction: 'high', precision: 0,
        fault: {
          target: 2800, rate: 30, actions: ['notify-rider'],
          title: '실내 공기 탁해짐',
          detail: '승객이 많은데 내기 순환이 이어져 이산화탄소가 쌓였습니다. 졸음운전 위험이 커지니 외기 유입이 필요합니다.',
        },
      },
      tirePressure('tire-fl', '앞왼쪽 타이어 공기압', 240, 210, 190, 176, ['speed-limit', 'tpms-recalibrate', 'dispatch-service']),
    ],
  },
]
