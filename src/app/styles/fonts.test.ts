import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('한글 웹 폰트', () => {
  it('화면 글자 파일에 소스의 한글·기호와 제목 글자가 모두 들어 있다 (빠졌으면 pnpm fonts)', () => {
    const output = execFileSync('node', ['scripts/build-fonts.mjs', '--check'], { encoding: 'utf8' })
    expect(output).toContain('OK')
  })
})
