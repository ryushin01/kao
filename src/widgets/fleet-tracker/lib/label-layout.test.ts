import { describe, expect, it } from 'vitest'
import { layoutLabels } from './label-layout'
import type { ProjectedPoint } from './label-layout'

// 탈것 이름표 100×40, 지명 60×16
const sizeOf = (id: string) => (id.startsWith('place:') ? { width: 60, height: 16 } : { width: 100, height: 40 })
const point = (id: string, x: number, y: number, visible = true): ProjectedPoint => ({ id, x, y, visible })
const byId = (placements: ReturnType<typeof layoutLabels>) => Object.fromEntries(placements.map((p) => [p.id, p]))
const view = { width: 1000, height: 800 }
const layout = (points: ProjectedPoint[], focusId: string | null = null) => byId(layoutLabels(points, sizeOf, focusId, view))

describe('layoutLabels', () => {
  it('겹치지 않으면 미니어처 바로 위 제자리에 둡니다', () => {
    const result = layout([point('a', 100, 300), point('b', 400, 300)])
    expect(result.a).toMatchObject({ left: 50, top: 260, leader: { dx: 0, dy: 0 }, shown: true })
    expect(result.b).toMatchObject({ left: 350, top: 260, leader: { dx: 0, dy: 0 }, shown: true })
  })

  it('겹치면 화면 아래쪽 탈것이 제자리를 갖고, 위쪽 탈것은 덜 움직이는 쪽(여기서는 위)으로 비켜 섭니다', () => {
    // b가 a보다 20px 위(화면 y가 작음)에 있어 이름표가 겹칩니다. 위로는 24px, 옆으로는 84px 움직여야 합니다.
    const result = layout([point('b', 120, 280), point('a', 100, 300)])
    expect(result.a!.top).toBe(260)
    // a 이름표 위(260)에서 b 높이(40)와 간격(4)만큼 위로, 선은 곧장 아래로 24px
    expect(result.b).toMatchObject({ left: 70, top: 216, leader: { dx: 0, dy: 24 } })
  })

  it('옆으로 조금만 비키면 되면 옆으로 섭니다(붙일 곳에 가까운 쪽)', () => {
    // b 이름표(110~210)가 a 이름표(200~300)와 10px 겹침: 왼쪽으로 14px 비키는 편이 위로 43px보다 적습니다.
    const result = layout([point('b', 160, 300), point('a', 250, 301)])
    expect(result.a).toMatchObject({ left: 200, top: 261 })
    expect(result.b).toMatchObject({ left: 96, top: 260, shown: true })
    // 선은 이름표 아래 가운데(146)에서 붙일 곳(160)까지 옆으로 14px
    expect(result.b!.leader).toEqual({ dx: 14, dy: 0 })
  })

  it('위로 비킬 자리가 화면 밖이면 옆으로 섭니다', () => {
    // g는 화면 맨 위 근처라 a 이름표 위로 올라가면 화면 밖(top < 0)입니다.
    const result = layout([point('g', 735, 50), point('a', 820, 80)])
    expect(result.a!.top).toBe(40)
    expect(result.g).toMatchObject({ left: 666, top: 10 })
  })

  it('양옆 이름표 사이에 끼어도 오가지 않고, 어느 이름표와도 겹치지 않는 가장 가까운 자리를 고릅니다', () => {
    // a·b는 맞붙어 있고 c는 그 사이 위쪽: 위로는 화면 밖, 오른쪽 504는 b와, 왼쪽 396은 a와 겹칩니다.
    const result = layout([point('c', 500, 49), point('a', 450, 50), point('b', 550, 50)])
    const rect = (id: string) => ({ left: result[id]!.left, top: result[id]!.top, right: result[id]!.left + 100, bottom: result[id]!.top + 40 })
    const overlaps = (x: ReturnType<typeof rect>, y: ReturnType<typeof rect>) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom
    expect(overlaps(rect('c'), rect('a'))).toBe(false)
    expect(overlaps(rect('c'), rect('b'))).toBe(false)
    // a 왼쪽(296)과 b 오른쪽(604)이 똑같이 154px 떨어져, 먼저 찾은 a 왼쪽을 고릅니다.
    expect(result.c).toMatchObject({ left: 296, top: 9 })
  })

  it('화면 안에 맞는 자리가 없으면 조금 잘리는 자리를 고르고, 많이 잘리면 겹치더라도 제자리에 둡니다', () => {
    // 폭 200 화면: b는 a 위(4px 잘림)나 옆(반 넘게 잘림)으로만 비킬 수 있어 위를 고릅니다.
    const narrow = byId(layoutLabels([point('b', 100, 50), point('a', 100, 80)], sizeOf, null, { width: 200, height: 400 }))
    expect(narrow.a).toMatchObject({ left: 50, top: 40 })
    expect(narrow.b).toMatchObject({ left: 50, top: -4 })
    // 폭 120 화면: 위는 24px(60%), 옆은 94% 잘려 모두 4분의 1을 넘으므로 제자리(겹침)에 둡니다.
    const tight = byId(layoutLabels([point('b', 60, 40), point('a', 60, 60)], sizeOf, null, { width: 120, height: 400 }))
    expect(tight.a).toMatchObject({ left: 10, top: 20 })
    expect(tight.b).toMatchObject({ left: 10, top: 0, leader: { dx: 0, dy: 0 } })
  })

  it('따라가는 탈것은 위쪽에 있어도 제자리를 갖습니다', () => {
    const result = layout([point('b', 120, 280), point('a', 100, 300)], 'b')
    expect(result.b).toMatchObject({ top: 240, leader: { dx: 0, dy: 0 } })
    expect(result.a!.top).toBe(240 - 40 - 4)
  })

  it('여러 번 겹쳐도 차례로 위로 쌓습니다', () => {
    const result = layout([point('a', 100, 300), point('b', 100, 299), point('c', 100, 298)])
    const tops = [result.a!.top, result.b!.top, result.c!.top].sort((x, y) => y - x)
    expect(tops).toEqual([260, 216, 172])
  })

  it('지명은 탈것 이름표나 먼저 놓인 지명과 겹치면 숨깁니다', () => {
    const result = layout([point('a', 100, 300), point('place:under', 100, 280), point('place:free', 400, 100), point('place:twin', 410, 104)])
    expect(result['place:under']!.shown).toBe(false)
    expect(result['place:free']).toMatchObject({ shown: true, left: 370, top: 92 })
    expect(result['place:twin']!.shown).toBe(false)
  })

  it('지명은 미니어처·상태 고리 자리와 겹쳐도 숨깁니다', () => {
    // 미니어처 위(이름표 붙는 곳) y 300, 바닥 y 320 → 고리까지 어림한 자리: x 74~126, y 300~335.6
    const vehicle = { ...point('a', 100, 300), baseY: 320 }
    const result = layout([vehicle, point('place:on-body', 110, 325), point('place:clear', 100, 360)])
    expect(result['place:on-body']!.shown).toBe(false)
    expect(result['place:clear']!.shown).toBe(true)
  })

  it('화면 밖 탈것은 다른 이름표를 밀어내지 않습니다', () => {
    const result = layout([point('hidden', 100, 300, false), point('a', 100, 290)])
    expect(result.hidden!.shown).toBe(false)
    expect(result.a).toMatchObject({ top: 250, leader: { dx: 0, dy: 0 }, shown: true })
  })
})
