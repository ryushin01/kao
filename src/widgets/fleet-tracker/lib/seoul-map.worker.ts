import { buildMapLayers, layerBuffers } from './map-geometry'
import type { SeoulMapData } from './map-geometry'

/**
 * 관제 지도 바탕을 메인 스레드 밖에서 만듭니다. 지도 데이터(수백 KB JSON)를 받아 풀고, 도로 띠·한강·공원·건물
 * 삼각형을 typed array로 만들어 복사 없이(transfer) 돌려줍니다. 메인 스레드는 이 배열로 메시만 만듭니다.
 */

/** 워커 전역(self)의 postMessage. 앱 타입 설정은 DOM 기준이라 self가 Window로 잡혀 직접 적습니다. */
const scope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent<{ url: string; unit: number }>) => void) => void
}

scope.addEventListener('message', async (event) => {
  try {
    const response = await fetch(event.data.url)
    if (!response.ok) throw new Error(`지도 데이터를 받지 못했습니다(${response.status}).`)
    const layers = buildMapLayers((await response.json()) as SeoulMapData, event.data.unit)
    scope.postMessage({ layers }, layerBuffers(layers))
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
})
