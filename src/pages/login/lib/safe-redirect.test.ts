import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safe-redirect'

describe('safeRedirect', () => {
  it('같은 사이트 안의 경로는 그대로 씁니다', () => {
    expect(safeRedirect('/fleet')).toBe('/fleet')
    expect(safeRedirect('/fleet/kao-0003?x=1#a')).toBe('/fleet/kao-0003?x=1#a')
  })

  it('다른 사이트로 가는 주소와 경로가 아닌 값은 버립니다', () => {
    for (const value of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 'fleet', '', undefined, ['/fleet']]) {
      expect(safeRedirect(value)).toBeNull()
    }
  })
})
