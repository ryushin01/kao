import { computed } from 'vue'
import { useRequestFetch, useState } from '#imports'
import type { SessionResponse, SessionUser } from '@shared/api'

/** 로그인한 사람과 웹 푸시 공개 키. 서버 렌더링 때 쿠키를 넘겨 받아 브라우저와 같은 값을 씁니다. */
export function useSession() {
  const state = useState<SessionResponse | null>('kao-session', () => null)
  const user = computed<SessionUser | null>(() => state.value?.user ?? null)
  const pushPublicKey = computed(() => state.value?.pushPublicKey ?? null)

  async function refresh() {
    state.value = await useRequestFetch()<SessionResponse>('/api/auth/session')
    return state.value
  }

  async function ensure() {
    return state.value ?? (await refresh())
  }

  function setUser(next: SessionUser | null) {
    state.value = { user: next, pushPublicKey: state.value?.pushPublicKey ?? null }
  }

  return { user, pushPublicKey, refresh, ensure, setUser }
}

/** 역할별 첫 화면: 관제 요원은 관제 센터, 회원은 자기 탈것 */
export function homePathFor(user: SessionUser) {
  return user.role === 'operator' ? '/fleet' : `/fleet/${user.vehicleIds[0] ?? ''}`
}
