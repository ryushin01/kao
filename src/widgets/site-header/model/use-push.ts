import { onMounted, ref } from 'vue'
import { deletePushSubscription, savePushSubscription, sendTestPush } from '@shared/api'

export type PushState = 'checking' | 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on'

function keyToBytes(base64url: string) {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** 위험 등급 웹 푸시 구독. 권한은 사용자가 켤 때만 요청합니다. */
export function usePush(publicKey: () => string | null) {
  const state = ref<PushState>('checking')
  const busy = ref(false)
  const message = ref('')
  let registration: ServiceWorkerRegistration | null = null

  onMounted(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      state.value = 'unsupported'
      return
    }
    if (!publicKey()) {
      state.value = 'unconfigured'
      return
    }
    try {
      registration = await navigator.serviceWorker.register('/sw.js')
      const existing = await registration.pushManager.getSubscription()
      if (Notification.permission === 'denied') {
        state.value = 'denied'
      } else if (existing) {
        // 브라우저에 남은 구독을 지금 로그인한 계정으로 다시 맞춥니다(다른 계정의 알림이 오지 않게).
        await savePushSubscription(existing.toJSON())
          .then(() => (state.value = 'on'))
          .catch(async () => {
            await existing.unsubscribe()
            state.value = 'off'
          })
      } else {
        state.value = 'off'
      }
    } catch {
      state.value = 'unsupported'
    }
  })

  async function enable() {
    const key = publicKey()
    if (!registration || !key || busy.value) return
    if (Notification.permission === 'denied') {
      message.value = '알림이 차단되어 있습니다. 브라우저 주소창의 사이트 설정에서 알림을 허용한 뒤 다시 눌러 주세요.'
      return
    }
    busy.value = true
    message.value = ''
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        state.value = permission === 'denied' ? 'denied' : 'off'
        message.value = '알림 권한을 받지 못했습니다. 브라우저 주소창의 사이트 설정에서 알림을 허용해 주세요.'
        return
      }
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) })
      try {
        await savePushSubscription(subscription.toJSON())
      } catch (error) {
        // 서버에 저장하지 못했으면 브라우저 구독도 되돌려, 켜진 것처럼 보이지 않게 합니다.
        await subscription.unsubscribe()
        throw error
      }
      state.value = 'on'
      message.value = '위험 알림을 켰습니다. 볼 수 있는 탈것에 위험 등급 문제가 생기면 알려 드립니다.'
    } catch (error) {
      message.value = error instanceof Error ? `알림을 켜지 못했습니다: ${error.message}` : '알림을 켜지 못했습니다.'
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    if (!registration || busy.value) return
    busy.value = true
    try {
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await deletePushSubscription(subscription.endpoint)
        await subscription.unsubscribe()
      }
      state.value = 'off'
      message.value = '위험 알림을 껐습니다.'
    } catch {
      message.value = '알림을 끄지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
    } finally {
      busy.value = false
    }
  }

  async function test() {
    if (busy.value) return
    busy.value = true
    try {
      const { sent } = await sendTestPush()
      message.value = sent > 0 ? '시험 알림을 보냈습니다.' : '보낼 구독이 없습니다. 알림을 껐다가 다시 켜 주세요.'
    } catch {
      message.value = '시험 알림을 보내지 못했습니다.'
    } finally {
      busy.value = false
    }
  }

  /** 로그아웃 전에 이 브라우저의 구독을 서버와 브라우저에서 모두 지웁니다. */
  async function clear() {
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await deletePushSubscription(subscription.endpoint).catch(() => {})
    await subscription.unsubscribe()
    state.value = 'off'
  }

  return { state, busy, message, enable, disable, test, clear }
}
