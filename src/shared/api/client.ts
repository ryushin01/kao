import type { HistoryResponse, LoginRequest, RemoteActionRequest, RemoteActionResponse, SessionUser } from './contract'

/** 차량 현황 한 번 받기. 화면은 서버 렌더링을 위해 Nuxt의 useFetch로 부릅니다. */
export const FLEET_URL = '/api/fleet'
/** 차량 현황 실시간 스트림(SSE) */
export const FLEET_STREAM_URL = `${FLEET_URL}/stream`

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `요청이 실패했습니다. (${response.status})`)
  }
  return (await response.json()) as T
}

export function sendRemoteAction(vehicleId: string, body: RemoteActionRequest): Promise<RemoteActionResponse> {
  return request<RemoteActionResponse>(`/api/vehicles/${encodeURIComponent(vehicleId)}/actions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function login(body: LoginRequest): Promise<{ user: SessionUser }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) })
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' })
}

export function fetchHistory(vehicleId: string, metric: string, minutes: number): Promise<HistoryResponse> {
  const query = new URLSearchParams({ metric, minutes: String(minutes) })
  return request(`/api/vehicles/${encodeURIComponent(vehicleId)}/history?${query}`)
}

export function savePushSubscription(subscription: PushSubscriptionJSON): Promise<{ ok: true }> {
  return request('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) })
}

export function deletePushSubscription(endpoint: string): Promise<{ ok: true }> {
  return request('/api/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) })
}

export function sendTestPush(): Promise<{ sent: number }> {
  return request('/api/push/test', { method: 'POST' })
}
