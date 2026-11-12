import type { VehicleModelId } from '@shared/api'

export interface ModelProfile {
  /** 화면에 쓰는 짧은 이름 */
  shortName: string
  /** 제조사를 붙인 이름 */
  displayName: string
  category: string
  specs: Array<{ label: string; value: string }>
}

/** 각 모델의 공개 제원(제조사 발표 기준 대략값) */
export const MODEL_PROFILES: Record<VehicleModelId, ModelProfile> = {
  'genesis-g80': {
    shortName: 'G80',
    displayName: 'Genesis G80',
    category: '대형 세단',
    specs: [
      { label: '전장', value: '4,995mm' },
      { label: '축거', value: '3,010mm' },
      { label: '엔진', value: '2.5 터보 I4' },
      { label: '구동', value: 'AWD' },
    ],
  },
  'lamborghini-aventador': {
    shortName: 'Aventador',
    displayName: 'Lamborghini Aventador',
    category: '슈퍼카',
    specs: [
      { label: '전장', value: '4,868mm' },
      { label: '축거', value: '2,700mm' },
      { label: '엔진', value: '6.5 V12 NA' },
      { label: '최고 출력', value: '780PS' },
    ],
  },
  'ducati-panigale-v4s': {
    shortName: 'Panigale V4 S',
    displayName: 'Ducati Panigale V4 S',
    category: '슈퍼바이크',
    specs: [
      { label: '전장', value: '2,110mm' },
      { label: '축거', value: '1,469mm' },
      { label: '엔진', value: '1,103cc V4' },
      { label: '서스펜션', value: 'Öhlins 전자식' },
    ],
  },
  'strida-lt': {
    shortName: 'Strida LT',
    displayName: 'STRiDA LT',
    category: '접이식 자전거',
    specs: [
      { label: '바퀴', value: '16인치' },
      { label: '프레임', value: '알루미늄 A자' },
      { label: '구동', value: '고무 벨트' },
      { label: '접은 길이', value: '약 1.1m' },
    ],
  },
}
