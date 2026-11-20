import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { FLEET_STREAM_URL, FLEET_URL } from '@shared/api'
import type { FleetFrame, RemoteActionResponse } from '@shared/api'
import { recallLastFrame, rememberLastFrame } from '@shared/lib'

export type StreamStatus = 'connecting' | 'live' | 'reconnecting'

export interface LiveFleetOptions {
  /** 세션이 끝나 401을 받으면 부릅니다(로그인 화면으로 보내기 등). 부른 뒤에는 다시 연결하지 않습니다. */
  onUnauthorized?: () => void
  /**
   * 마지막으로 받은 상태를 이 사람(로그인한 사람 id) 것으로 기기에 저장하고, 화면을 열 때 저장한 상태가 더 새것이면 그것으로
   * 시작합니다(오프라인에서 저장해 둔 화면을 열 때). 로그아웃해 id가 없으면 저장하지 않습니다.
   */
  rememberAs?: () => string | null | undefined
}

/** 다시 연결할 때 기다리는 시간(ms): 1·2·4·8·16초, 그 뒤로는 30초마다 */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]
/** 탭이 이만큼 숨겨져 있으면 스트림을 닫습니다(ms). 다시 보이면 곧바로 이어 받습니다. */
export const HIDDEN_GRACE_MS = 60_000
/** 마지막 상태를 기기에 저장하는 간격(ms). 연결이 끊기는 순간과 화면을 떠날 때는 바로 저장합니다. */
export const REMEMBER_INTERVAL_MS = 10_000

/**
 * 서버가 보낸 첫 프레임(SSR)으로 시작해서, 브라우저에서는 SSE 스트림으로 계속 바꿉니다.
 *
 * EventSource는 네트워크가 끊기면 스스로 다시 붙지만, 서버가 200이 아닌 응답(세션이 끝난 401, 배포·장애의 5xx)을 주면
 * 연결을 영영 닫습니다. 그때는 현재 프레임을 한 번 받아 보고, 401이면 onUnauthorized를 부르고, 아니면 점점 길게 기다리며
 * 다시 연결합니다. 탭이 오래 숨겨져 있으면 스트림을 닫아 전송량·서버 시간을 아끼고, 다시 보이면 곧바로 이어 받습니다
 * (위험 알림은 웹 푸시가 맡습니다).
 */
export function useLiveFleet(initial: Ref<FleetFrame | null | undefined>, { onUnauthorized, rememberAs }: LiveFleetOptions = {}) {
  const frame = shallowRef<FleetFrame | null>(initial.value ?? null)
  const status = ref<StreamStatus>('connecting')
  let source: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let stopped = false
  /** 숨긴 탭이라 일부러 닫아 둔 상태 */
  let paused = false
  let rememberTimer: ReturnType<typeof setTimeout> | undefined

  const accept = (next: FleetFrame) => {
    if (!frame.value || next.at >= frame.value.at) frame.value = next
  }

  watch(initial, (value) => {
    if (value) accept(value)
  })

  function remember() {
    clearTimeout(rememberTimer)
    rememberTimer = undefined
    const userId = rememberAs?.()
    if (userId && frame.value) void rememberLastFrame(userId, frame.value).catch(() => {})
  }

  function scheduleRemember() {
    if (rememberAs && !rememberTimer) rememberTimer = setTimeout(remember, REMEMBER_INTERVAL_MS)
  }

  function close() {
    source?.close()
    source = null
  }

  function connect() {
    close()
    if (stopped || paused) return
    const stream = new EventSource(FLEET_STREAM_URL)
    source = stream
    stream.addEventListener('frame', (event) => {
      try {
        frame.value = JSON.parse((event as MessageEvent<string>).data) as FleetFrame
      } catch {
        return
      }
      status.value = 'live'
      attempts = 0
      scheduleRemember()
    })
    stream.addEventListener('error', () => {
      if (source !== stream) return
      status.value = 'reconnecting'
      // CONNECTING이면 EventSource가 스스로 다시 붙습니다. CLOSED면 더는 시도하지 않으므로 직접 다시 엽니다.
      if (stream.readyState === EventSource.CLOSED) {
        close()
        scheduleRecovery()
      }
    })
  }

  function scheduleRecovery() {
    clearTimeout(retryTimer)
    if (stopped || paused) return
    const delay = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)]!
    attempts += 1
    retryTimer = setTimeout(() => void recover(), delay)
  }

  /** 현재 프레임을 받아 바로 보여 주고 스트림을 다시 엽니다. 401이면 세션이 끝난 것입니다. */
  async function recover() {
    clearTimeout(retryTimer)
    if (stopped || paused) return
    let response: Response
    try {
      response = await fetch(FLEET_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
    } catch {
      scheduleRecovery()
      return
    }
    if (stopped || paused) return
    if (response.status === 401) {
      stopped = true
      status.value = 'reconnecting'
      onUnauthorized?.()
      return
    }
    if (!response.ok) {
      scheduleRecovery()
      return
    }
    try {
      accept((await response.json()) as FleetFrame)
    } catch {
      // 프레임을 읽지 못해도 스트림은 다시 엽니다.
    }
    connect()
  }

  function onVisibility() {
    if (stopped) return
    if (document.visibilityState === 'hidden') {
      clearTimeout(hiddenTimer)
      hiddenTimer = setTimeout(() => {
        if (document.visibilityState !== 'hidden') return
        paused = true
        clearTimeout(retryTimer)
        close()
      }, HIDDEN_GRACE_MS)
      return
    }
    clearTimeout(hiddenTimer)
    if (!paused) return
    paused = false
    attempts = 0
    status.value = 'connecting'
    void recover()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    connect()
    if (!rememberAs) return
    window.addEventListener('offline', remember)
    window.addEventListener('pagehide', remember)
    const userId = rememberAs()
    if (userId) {
      void recallLastFrame<FleetFrame>(userId)
        .then((stored) => {
          if (stored) accept(stored)
        })
        .catch(() => {})
    }
  })

  onBeforeUnmount(() => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(retryTimer)
    clearTimeout(hiddenTimer)
    close()
    if (!rememberAs) return
    window.removeEventListener('offline', remember)
    window.removeEventListener('pagehide', remember)
    // 다른 화면으로 옮길 때 마지막 상태를 남깁니다(로그아웃이면 로그인한 사람이 없어 남기지 않음).
    remember()
  })

  /** 원격 조치 응답처럼 스트림보다 먼저 받은 차량 상태와 기록을 바로 반영합니다. */
  const applyAction = ({ vehicle, entry }: RemoteActionResponse) => {
    if (!frame.value) return
    frame.value = {
      ...frame.value,
      vehicles: frame.value.vehicles.map((item) => (item.id === vehicle.id ? vehicle : item)),
      log: frame.value.log.some((item) => item.id === entry.id) ? frame.value.log : [entry, ...frame.value.log],
    }
  }

  return { frame, status, applyAction }
}
