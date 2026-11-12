import type { VehicleKind, VehicleModelId } from '@shared/api'

export interface VehicleCategory {
  kind: VehicleKind
  label: string
  description: string
  /** 분류를 대표하는 모델. 이 모델의 3D 미니어처를 분류 소개에 씁니다. */
  representative: VehicleModelId
}

/** 탈것 분류. 같은 분류에 탈것이 늘어나도 이 목록과 순서를 그대로 씁니다. */
export const VEHICLE_CATEGORIES: readonly VehicleCategory[] = [
  { kind: 'sedan', label: '세단', description: '도심과 고속도로를 오가는 일상용 승용차', representative: 'genesis-g80' },
  { kind: 'supercar', label: '슈퍼카', description: '고출력 엔진과 카본 세라믹 브레이크를 쓰는 고성능 차', representative: 'lamborghini-aventador' },
  { kind: 'superbike', label: '슈퍼바이크', description: '서킷을 달리는 고성능 모터사이클', representative: 'ducati-panigale-v4s' },
  { kind: 'bicycle', label: '자전거', description: '사람 힘으로 달리는 접이식 자전거', representative: 'strida-lt' },
]

export const CATEGORY_LABELS = Object.fromEntries(VEHICLE_CATEGORIES.map((category) => [category.kind, category.label])) as Record<
  VehicleKind,
  string
>
