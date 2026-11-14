import { sendNotification, setVapidDetails } from 'web-push'
import { criticalIssues } from './sim/engine'
import { frameInput } from './fleet'
import { useStore } from './store'
import type { PushSubscriptionRecord } from './store'

let configured: boolean | null = null

/** 브라우저 푸시 서비스 주소만 받습니다(다른 주소로 서버가 요청을 보내는 SSRF 방지). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]

export function isPushEndpoint(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((pattern) => pattern.test(url.hostname))
  } catch {
    return false
  }
}

export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? null
}

function ensureConfigured() {
  if (configured !== null) return configured
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  configured = Boolean(publicKey && privateKey)
  if (configured) setVapidDetails(process.env.VAPID_SUBJECT ?? 'https://kao-ryushin01.vercel.app', publicKey!, privateKey!)
  return configured
}

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

/** 보냈으면 'sent', 구독이 사라졌으면 'gone', 일시적으로 실패하면 'failed' */
async function deliver(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<'sent' | 'gone' | 'failed'> {
  if (!isPushEndpoint(subscription.endpoint)) return 'gone'
  try {
    await sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { TTL: 600, urgency: 'high' },
    )
    return 'sent'
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    // 브라우저에서 구독을 지웠으면(404·410) 우리 쪽 기록도 지웁니다.
    if (status === 404 || status === 410) {
      await useStore().deletePushSubscription(subscription.endpoint, subscription.userId)
      return 'gone'
    }
    return 'failed'
  }
}

export async function sendTestPush(userId: string) {
  if (!ensureConfigured()) return 0
  const subscriptions = (await useStore().listPushSubscriptions()).filter((item) => item.userId === userId)
  const results = await Promise.all(
    subscriptions.map((subscription) =>
      deliver(subscription, { title: 'KAO 알림 시험', body: '위험 등급 문제가 생기면 이렇게 알려 드립니다.', url: '/', tag: 'kao-test' }),
    ),
  )
  return results.filter((result) => result === 'sent').length
}

/**
 * 위험 등급이 된 열린 문제를 볼 수 있는 사람에게 알립니다. 문제·구독마다 한 번만 보내고,
 * 일시적으로 실패하면 기록을 지워 다음 검사 때 다시 보냅니다.
 * GitHub Actions가 5분마다 /api/cron/notify를 부르고, 관제 화면이 열려 있으면 스트림도 30초마다 부릅니다.
 */
export async function notifyCriticalIssues(now = Date.now()) {
  if (!ensureConfigured()) return { sent: 0, issues: 0 }
  const store = useStore()
  const issues = criticalIssues(await frameInput(now))
  if (issues.length === 0) return { sent: 0, issues: 0 }
  const subscriptions = await store.listPushSubscriptions()
  let sent = 0
  for (const { vehicle, issue } of issues) {
    const targets = subscriptions.filter((item) => item.role === 'operator' || item.vehicleIds.includes(vehicle.id))
    const payload: PushPayload = {
      title: `위험: ${vehicle.maker} ${vehicle.model}`,
      body: `${issue.title} — ${issue.detail}`,
      url: `/fleet/${vehicle.id}`,
      tag: issue.id,
    }
    await Promise.all(
      targets.map(async (target) => {
        if (!(await store.claimDelivery(issue.id, target.endpoint))) return
        const result = await deliver(target, payload)
        if (result === 'sent') sent += 1
        else if (result === 'failed') await store.releaseDelivery(issue.id, target.endpoint)
      }),
    )
  }
  return { sent, issues: issues.length }
}

let lastOpportunistic = 0

const isDue = (now: number) => {
  if (!ensureConfigured() || now - lastOpportunistic < 30_000) return false
  lastOpportunistic = now
  return true
}

/** 관제 스트림이 열려 있을 때 30초에 한 번씩 알림을 검사합니다(인스턴스마다). 스트림이 열려 있는 동안이라 기다리지 않습니다. */
export function maybeNotify(now = Date.now()) {
  if (isDue(now)) void notifyCriticalIssues(now).catch(() => {})
}

/**
 * 실차 측정값을 받을 때도 30초에 한 번 알림을 검사합니다(인스턴스마다). 관제 화면을 보는 사람이 없고 예약 검사가 늦어도
 * 실측 위험 문제는 바로 알리기 위해서입니다. 서버리스 함수가 응답 뒤 멈추지 않도록 끝날 때까지 기다립니다.
 */
export async function notifyIfDue(now = Date.now()) {
  if (isDue(now)) await notifyCriticalIssues(now).catch(() => {})
}
