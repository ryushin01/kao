import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { FLEET_STREAM_URL } from '@shared/api'
import type { FleetFrame } from '@shared/api'

export type StreamStatus = 'connecting' | 'live' | 'reconnecting'

/**
 * 서버가 보낸 첫 프레임(SSR)으로 시작해서, 브라우저에서는 SSE 스트림으로 계속 바꿉니다.
 * EventSource는 끊기면 스스로 다시 연결합니다.
 */
export function useLiveFleet(initial: Ref<FleetFrame | null | undefined>) {
  const frame = shallowRef<FleetFrame | null>(initial.value ?? null)
  const status = ref<StreamStatus>('connecting')
  let source: EventSource | null = null

  watch(initial, (value) => {
    if (value && (!frame.value || value.at > frame.value.at)) frame.value = value
  })

  onMounted(() => {
    source = new EventSource(FLEET_STREAM_URL)
    source.addEventListener('frame', (event) => {
      frame.value = JSON.parse((event as MessageEvent<string>).data) as FleetFrame
      status.value = 'live'
    })
    source.addEventListener('error', () => {
      status.value = 'reconnecting'
    })
  })

  onBeforeUnmount(() => {
    source?.close()
    source = null
  })

  /** 원격 조치 응답처럼 스트림보다 먼저 받은 차량 상태를 바로 반영합니다. */
  const patchVehicle = (vehicle: FleetFrame['vehicles'][number]) => {
    if (!frame.value) return
    frame.value = {
      ...frame.value,
      vehicles: frame.value.vehicles.map((item) => (item.id === vehicle.id ? vehicle : item)),
    }
  }

  return { frame, status, patchVehicle }
}
