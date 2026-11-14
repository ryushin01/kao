import type { VehicleKind, VehicleModelId } from '@shared/api'

export interface VehicleCategory {
  kind: VehicleKind
  label: string
  description: string
  /** 분류를 대표하는 모델. 이 모델의 3D 미니어처를 분류 소개에 씁니다. */
  representative: VehicleModelId
  /**
   * 대표 모델이 관제 센터에 등록된 탈것이 아니면(소개 화면에만 나오는 분류) 보여 줄 도장과 바퀴를 굴릴 속도(km/h).
   * 등록된 탈것이면 그 탈것의 도장·속도를 씁니다.
   */
  showcase?: { paint: { name: string; hex: string }; speed: number }
}

/** 탈것 분류. 같은 분류에 탈것이 늘어나도 이 목록과 순서를 그대로 씁니다. */
export const VEHICLE_CATEGORIES: readonly VehicleCategory[] = [
  { kind: 'sedan', label: '세단', description: '도심과 고속도로를 오가는 일상용 승용차', representative: 'genesis-g80' },
  { kind: 'supercar', label: '슈퍼카', description: '고출력 엔진과 카본 세라믹 브레이크를 쓰는 고성능 차', representative: 'lamborghini-aventador' },
  { kind: 'superbike', label: '슈퍼바이크', description: '서킷을 달리는 고성능 모터사이클', representative: 'ducati-panigale-v4s' },
  { kind: 'bicycle', label: '자전거', description: '사람 힘으로 달리는 접이식 자전거', representative: 'strida-lt' },
  {
    kind: 'ev',
    label: '전기자동차',
    description: '배터리와 전기 모터로 달리는 차',
    representative: 'genesis-essentia',
    showcase: { paint: { name: '건메탈 그레이', hex: '#4a4c52' }, speed: 40 },
  },
  {
    kind: 'suv',
    label: 'SUV',
    description: '지상고가 높아 험한 길도 다니는 다목적 차',
    representative: 'renault-arkana',
    showcase: { paint: { name: '화이트', hex: '#e8e8e5' }, speed: 40 },
  },
  {
    kind: 'mpv',
    label: 'MPV',
    description: '넓은 실내에 여럿이 타는 다인승 차',
    representative: 'toyota-alphard',
    showcase: { paint: { name: '블랙', hex: '#0d0d0f' }, speed: 40 },
  },
]

export const CATEGORY_LABELS = Object.fromEntries(VEHICLE_CATEGORIES.map((category) => [category.kind, category.label])) as Record<
  VehicleKind,
  string
>
