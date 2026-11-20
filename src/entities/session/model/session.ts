import { computed } from 'vue'
import { clearNuxtData, navigateTo, useRequestFetch, useRoute, useState } from '#imports'
import type { SessionResponse, SessionUser } from '@shared/api'
import { forgetPrivatePages } from '@shared/lib'

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

/**
 * 화면을 연 채 세션이 끝났을 때(실시간 스트림이 401을 받음) 부를 함수를 돌려줍니다. 받아 둔 관제 데이터와 이 기기에 저장한
 * 관제 화면(오프라인용)을 비우고 로그인 화면으로 보내며, 다시 로그인하면 지금 화면으로 돌아옵니다. setup 안에서 부릅니다.
 */
export function useSessionExpiry() {
  const route = useRoute()
  const { setUser } = useSession()
  return () => {
    setUser(null)
    clearNuxtData()
    void forgetPrivatePages().catch(() => {})
    void navigateTo({ path: '/login', query: { redirect: route.fullPath } })
  }
}
