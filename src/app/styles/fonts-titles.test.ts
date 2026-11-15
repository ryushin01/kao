import { describe, expect, it } from 'vitest'
import { collectTitles } from '../../../scripts/fonts/titles.mjs'

describe('제목 글꼴(오빗)에 담을 글자', () => {
  it('제목에 직접 적은 글자와 title 속성 값을 모은다', () => {
    const text = collectTitles('<template><h1>관제 센터</h1><ActionLog title="조치 기록" /></template>').join('')
    expect(text).toContain('관제 센터')
    expect(text).toContain('조치 기록')
  })

  it('제목에 쓰는 변수의 값이 다음 줄에 있어도 끝까지 모은다', () => {
    const vue = [
      '<script setup lang="ts">',
      'const heading = computed(() =>',
      "  notFound.value",
      "    ? '사건의 지평선 너머로 사라진 화면입니다'",
      "    : '관제 신호가 끊겼습니다',",
      ')',
      'const other = "제목이 아닌 글자"',
      '</script>',
      '<template><h1>{{ heading }}</h1></template>',
    ].join('\n')
    const text = collectTitles(vue).join('')
    expect(text).toContain('사건의 지평선 너머로 사라진 화면입니다')
    expect(text).toContain('관제 신호가 끊겼습니다')
    expect(text).not.toContain('제목이 아닌 글자')
  })

  it('위젯의 기본 제목(withDefaults)을 모은다', () => {
    const vue = [
      '<script setup lang="ts">',
      'const props = withDefaults(defineProps<{ title?: string }>(), {',
      "  title:",
      "    '원격 조치 기록',",
      '})',
      '</script>',
      '<template><h2>{{ title }}</h2></template>',
    ].join('\n')
    expect(collectTitles(vue).join('')).toContain('원격 조치 기록')
  })
})
