/**
 * 요소가 화면 가까이(rootMargin 안) 들어오면 callback을 한 번 부르고 관찰을 멈춥니다.
 * 3D 장면처럼 무거운 것을 화면에 보일 때가 되어서야 만들 때 씁니다. IntersectionObserver가 없으면 바로 부릅니다.
 * 돌려준 함수를 부르면(예: 화면을 떠날 때) 아직 부르지 않은 callback을 취소합니다.
 */
export function whenNearViewport(element: Element, callback: () => void, rootMargin = '300px 0px'): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback()
    return () => {}
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      callback()
    },
    { rootMargin },
  )
  observer.observe(element)
  return () => observer.disconnect()
}
