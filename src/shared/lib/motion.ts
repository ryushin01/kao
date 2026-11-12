import { readonly, ref } from 'vue'

const STORAGE_KEY = 'kao:motion'
const paused = ref(false)
let initialized = false

/**
 * 장식용 움직임(블랙홀, 자동 회전, 위치 보간)을 멈추는 전역 상태입니다.
 * 운영체제의 '동작 줄이기' 설정을 따르고, 사용자가 고른 값은 기억합니다.
 */
export function initMotionPreference() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  paused.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'paused' || saved === 'playing') paused.value = saved === 'paused'
  } catch {
    // 저장소를 쓸 수 없는 환경이면 운영체제 설정만 따릅니다.
  }
}

export function useMotion() {
  const setPaused = (value: boolean) => {
    paused.value = value
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'paused' : 'playing')
    } catch {
      // 무시합니다.
    }
  }
  return { paused: readonly(paused), setPaused, toggle: () => setPaused(!paused.value) }
}
