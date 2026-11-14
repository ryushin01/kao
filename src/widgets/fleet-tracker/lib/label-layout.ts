/** 이름표를 붙일 곳의 화면 좌표(캔버스 기준 px). 탈것은 미니어처 바로 위, 지명은 그 자리입니다. */
export interface ProjectedPoint {
  /** 탈것 id 또는 place:지명 id */
  id: string
  x: number
  y: number
  /** 카메라 앞이고 화면 안(조금 밖까지)인지 */
  visible: boolean
  /** 탈것만: 미니어처가 놓인 바닥의 화면 y. 미니어처·상태 고리가 차지하는 자리를 어림하는 데 씁니다. */
  baseY?: number
}

export interface LabelSize {
  width: number
  height: number
}

export interface LabelPlacement {
  id: string
  /** 이름표 왼쪽 위 모서리(px) */
  left: number
  top: number
  /** 이름표 아래 가운데에서 붙일 곳(미니어처 위)까지(px). 다른 이름표를 피해 비켜 섰을 때 이 선으로 잇습니다. */
  leader: { dx: number; dy: number }
  shown: boolean
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * 탈것 이름표와 지명이 서로 겹치지 않게 놓습니다.
 * - 탈것 이름표의 제자리는 미니어처 바로 위(가운데 맞춤)입니다. 따라가는 탈것을 먼저, 나머지는 화면 아래쪽(카메라에 가까운 쪽)부터
 *   놓습니다. 제자리가 먼저 놓인 이름표와 겹치면, 먼저 놓인 이름표마다 그 위·왼쪽·오른쪽 자리를 후보로 두고 어느 이름표와도
 *   겹치지 않는 자리 가운데 덜 움직이고 화면(view) 밖으로 덜 잘리는 곳을 고릅니다. 그런 자리가 없거나 가장 나은 자리도
 *   4분의 1 넘게 잘리면 제자리에 둡니다(겹쳐도 보이는 편이 잘려 안 보이는 것보다 낫습니다).
 * - 지명은 그 자리 가운데에 두되, 탈것 이름표·미니어처나 먼저 놓인 지명과 겹치면 숨깁니다(지명은 길 찾기를 돕는 꾸밈).
 */
export function layoutLabels(
  points: readonly ProjectedPoint[],
  sizeOf: (id: string) => LabelSize,
  focusId: string | null,
  view: LabelSize,
  gap = 4,
): LabelPlacement[] {
  const placed: Rect[] = []
  const result: LabelPlacement[] = []
  const vehicles = points
    .filter((point) => !point.id.startsWith('place:'))
    .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || b.y - a.y)
  for (const point of vehicles) {
    const { width, height } = sizeOf(point.id)
    const home = { left: point.x - width / 2, top: point.y - height }
    let spot = home
    if (point.visible) {
      const rectAt = ({ left, top }: { left: number; top: number }) => ({ left, top, right: left + width, bottom: top + height })
      const free = (candidate: { left: number; top: number }) => !placed.some((other) => overlaps(other, rectAt(candidate)))
      /** 화면 밖으로 잘리는 넓이 비율(0~1) */
      const hidden = ({ left, top }: { left: number; top: number }) => {
        const shownWidth = Math.max(0, Math.min(left + width, view.width) - Math.max(left, 0))
        const shownHeight = Math.max(0, Math.min(top + height, view.height) - Math.max(top, 0))
        return 1 - (shownWidth * shownHeight) / (width * height)
      }
      if (!free(home)) {
        const candidates = placed.flatMap((other) => [
          { left: home.left, top: other.top - height - gap },
          { left: other.left - width - gap, top: home.top },
          { left: other.right + gap, top: home.top },
        ])
        // 움직인 거리(px)에 잘리는 비율만큼 벌점(전부 잘리면 1000px)을 더해, 가장 작은 자리를 고릅니다.
        const cost = (candidate: { left: number; top: number }) =>
          Math.hypot(candidate.left - home.left, candidate.top - home.top) + hidden(candidate) * 1000
        const best = candidates.filter(free).reduce<{ left: number; top: number } | null>(
          (found, candidate) => (found && cost(found) <= cost(candidate) ? found : candidate),
          null,
        )
        if (best && hidden(best) <= 0.25) spot = best
      }
      placed.push(rectAt(spot))
    }
    result.push({
      id: point.id,
      left: spot.left,
      top: spot.top,
      leader: { dx: point.x - (spot.left + width / 2), dy: point.y - (spot.top + height) },
      shown: point.visible,
    })
  }
  // 미니어처와 상태 고리 자리: 이름표가 붙는 곳(미니어처 위)부터 바닥 아래 고리까지, 폭은 그 높이에 비례해 어림합니다.
  for (const point of vehicles) {
    if (!point.visible || point.baseY === undefined) continue
    const radius = Math.max(8, (point.baseY - point.y) * 1.3)
    placed.push({ left: point.x - radius, right: point.x + radius, top: point.y, bottom: point.baseY + radius * 0.6 })
  }
  for (const point of points) {
    if (!point.id.startsWith('place:')) continue
    const { width, height } = sizeOf(point.id)
    const rect = { left: point.x - width / 2, top: point.y - height / 2, right: point.x + width / 2, bottom: point.y + height / 2 }
    const shown = point.visible && !placed.some((other) => overlaps(other, rect))
    if (shown) placed.push(rect)
    result.push({ id: point.id, left: rect.left, top: rect.top, leader: { dx: 0, dy: 0 }, shown })
  }
  return result
}
