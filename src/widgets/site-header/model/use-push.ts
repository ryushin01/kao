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
      state.value = Notification.permission === 'denied' ? 'denied' : existing ? 'on' : 'off'
    } catch {
      state.value = 'unsupported'
    }
  })

  async function enable() {
    const key = publicKey()
    if (!registration || !key || busy.value) return
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
      await savePushSubscription(subscription.toJSON())
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

  return { state, busy, message, enable, disable, test }
}
