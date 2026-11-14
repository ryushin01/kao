import { ref } from 'vue'
import { login as requestLogin } from '@shared/api'
import type { LoginRequest, SessionUser } from '@shared/api'

interface Options {
  send?: (body: LoginRequest) => Promise<{ user: SessionUser }>
  onSuccess?: (user: SessionUser) => void | Promise<void>
}

/**
 * 로그인 요청. 보낼 값은 mutate(data)로 넘기고, 빠른 연속 클릭은 동기 잠금으로 막습니다.
 * 성공하면 화면을 떠나므로 실패했을 때만 잠금을 풉니다.
 */
export function useLogin({ send = requestLogin, onSuccess }: Options = {}) {
  const isPending = ref(false)
  const error = ref<string | null>(null)
  let locked = false

  async function mutate(data: LoginRequest) {
    if (locked) return
    locked = true
    isPending.value = true
    error.value = null
    try {
      const { user } = await send(data)
      await onSuccess?.(user)
    } catch (cause) {
      locked = false
      error.value = cause instanceof Error ? cause.message : '로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
    } finally {
      isPending.value = false
    }
  }

  return { mutate, isPending, error }
}
