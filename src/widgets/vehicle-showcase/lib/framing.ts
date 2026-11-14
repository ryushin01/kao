import { Vector3 } from 'three'

/** 대상에서 카메라 쪽으로 향하는 방향(비스듬히 앞에서 조금 내려다봄) */
const VIEW_DIRECTION = new Vector3(0.78, 0.36, 0.92).normalize()
/** 턴테이블 가장자리는 화면 높이 반의 이 비율 안에 둡니다(진홍 고리가 화면 끝에 붙지 않게). */
const EDGE_MARGIN = 0.9

export interface ShowcaseFraming {
  /** 카메라가 바라보는 점(미니어처 경계 상자의 가운데) */
  target: Vector3
  position: Vector3
  distance: number
  /** 턴테이블 반지름(m) */
  turntable: number
}

/**
 * 미니어처와 턴테이블이 모두 화면에 들도록 카메라 자리를 정합니다(fov는 세로 시야각, 도).
 * 먼저 미니어처의 경계 구가 화면 높이에 맞는 거리를 잡고, 키가 큰 탈것(SUV·MPV)처럼 바라보는 점이 높아져
 * 턴테이블 앞쪽 가장자리가 화면 아래로 벗어나면 가장자리가 들어올 때까지 물러납니다.
 */
export function frameShowcase(center: Vector3, size: Vector3, length: number, fov: number): ShowcaseFraming {
  const halfFov = (fov * Math.PI) / 360
  const radius = Math.max(size.length() / 2, 0.6)
  const turntable = Math.max(1, length * 0.62)
  // 턴테이블(원점 중심)에서 카메라에 가장 가까운 가장자리가 화면에서 가장 아래에 보입니다.
  const edge = new Vector3(VIEW_DIRECTION.x, 0, VIEW_DIRECTION.z).normalize().multiplyScalar(turntable)
  const axis = VIEW_DIRECTION.clone().negate()
  const offAxis = (distance: number) => edge.clone().sub(center.clone().addScaledVector(VIEW_DIRECTION, distance)).angleTo(axis)

  let distance = (radius / Math.sin(halfFov)) * 0.82
  for (let i = 0; i < 40 && offAxis(distance) > halfFov * EDGE_MARGIN; i += 1) distance *= 1.03
  return { target: center.clone(), position: center.clone().addScaledVector(VIEW_DIRECTION, distance), distance, turntable }
}
