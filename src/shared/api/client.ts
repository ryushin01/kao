import type { FleetFrame, RemoteActionRequest, RemoteActionResponse } from './contract'

export const FLEET_STREAM_URL = '/api/fleet/stream'

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

export function fetchFleet(): Promise<FleetFrame> {
  return request<FleetFrame>('/api/fleet')
}

export function sendRemoteAction(vehicleId: string, body: RemoteActionRequest): Promise<RemoteActionResponse> {
  return request<RemoteActionResponse>(`/api/vehicles/${encodeURIComponent(vehicleId)}/actions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
