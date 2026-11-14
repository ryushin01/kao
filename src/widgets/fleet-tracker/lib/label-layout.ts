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
 *   놓고, 먼저 놓인 이름표와 겹치면 그 위나 옆(붙일 곳에 가까운 쪽) 가운데 덜 움직이는 쪽으로 비켜 섭니다. 화면(view) 밖으로
 *   나가는 자리는 고르지 않습니다.
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
    let left = point.x - width / 2
    let top = point.y - height
    if (point.visible) {
      // 비킬 때마다 먼저 놓인 이름표 하나를 넘으므로, 그 수의 두 배만큼 다시 보면 충분합니다.
      for (let tries = 0; tries <= placed.length * 2; tries += 1) {
        const rect = { left, top, right: left + width, bottom: top + height }
        const hit = placed.find((other) => overlaps(other, rect))
        if (!hit) break
        const above = hit.top - height - gap
        const side = point.x < (hit.left + hit.right) / 2 ? hit.left - width - gap : hit.right + gap
        const aboveFits = above >= 0
        const sideFits = side >= 0 && side + width <= view.width
        if (aboveFits && (!sideFits || top - above <= Math.abs(side - left))) top = above
        else left = side
      }
      placed.push({ left, top, right: left + width, bottom: top + height })
    }
    result.push({ id: point.id, left, top, leader: { dx: point.x - (left + width / 2), dy: point.y - (top + height) }, shown: point.visible })
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
