import { ref } from 'vue'
import { sendRemoteAction } from '@shared/api'
import type { RemoteActionRequest, RemoteActionResponse } from '@shared/api'

export interface RemoteActionVariables extends RemoteActionRequest {
  vehicleId: string
}

interface Options {
  send?: (vehicleId: string, body: RemoteActionRequest) => Promise<RemoteActionResponse>
  onSuccess?: (response: RemoteActionResponse) => void
}

/**
 * 원격 조치 명령을 보냅니다. 보낼 값은 mutate(data)로 직접 넘깁니다.
 * isPending은 다음 렌더에야 화면에 반영되므로, 빠른 연속 클릭은 동기 잠금(locked)으로 막습니다.
 * 성공하면 그 문제는 '조치 중'으로 바뀌어 다시 보낼 일이 없으므로 실패했을 때만 잠금을 풉니다.
 */
export function useRemoteAction({ send = sendRemoteAction, onSuccess }: Options = {}) {
  const isPending = ref(false)
  const error = ref<string | null>(null)
  const lastResponse = ref<RemoteActionResponse | null>(null)
  let locked = false

  async function mutate({ vehicleId, issueId, action }: RemoteActionVariables) {
    if (locked) return
    locked = true
    isPending.value = true
    error.value = null
    try {
      const response = await send(vehicleId, { issueId, action })
      lastResponse.value = response
      onSuccess?.(response)
    } catch (cause) {
      locked = false
      error.value = cause instanceof Error ? cause.message : '명령을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
    } finally {
      isPending.value = false
    }
  }

  return { mutate, isPending, error, lastResponse }
}
