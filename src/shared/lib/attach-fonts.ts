/** 페이지를 다 받은 뒤 기다리는 시간. 첫 화면 그리기와 겹치지 않게 함 */
const DELAY_MS = 1000
const IDLE_TIMEOUT_MS = 2000

/**
 * 한글 나머지 글자 조각 CSS를 페이지를 다 받고 한가할 때 붙입니다(조각 파일은 그 글자를 쓸 때만 받음).
 * 취소 함수를 돌려줍니다.
 */
export function attachFonts(href: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: number | undefined
  let link: HTMLLinkElement | undefined
  const attach = () => {
    link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    // print로 걸어 가장 낮은 우선순위로 받고, 다 받은 뒤 화면에 적용
    link.media = 'print'
    link.onload = () => {
      if (link) link.media = 'all'
    }
    document.head.append(link)
  }
  const schedule = () => {
    timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function')
        idle = window.requestIdleCallback(attach, { timeout: IDLE_TIMEOUT_MS })
      else attach()
    }, DELAY_MS)
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
  return () => {
    clearTimeout(timer)
    window.removeEventListener('load', schedule)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    link?.remove()
  }
}
