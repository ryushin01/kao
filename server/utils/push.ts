import { sendNotification, setVapidDetails } from 'web-push'
import { criticalIssues } from './sim/engine'
import { todaysActions } from './fleet'
import { useStore } from './store'
import type { PushSubscriptionRecord } from './store'

let configured: boolean | null = null

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

async function deliver(subscription: PushSubscriptionRecord, payload: PushPayload) {
  try {
    await sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { TTL: 600, urgency: 'high' },
    )
    return true
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    // 브라우저에서 구독을 지웠으면(404·410) 우리 쪽 기록도 지웁니다.
    if (status === 404 || status === 410) await useStore().deletePushSubscription(subscription.endpoint, subscription.userId)
    return false
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
  return results.filter(Boolean).length
}

/**
 * 위험 등급이 된 열린 문제를 볼 수 있는 사람에게 알립니다. 문제마다 한 번만 보냅니다.
 * GitHub Actions가 5분마다 /api/cron/notify를 부르고, 관제 화면이 열려 있으면 스트림도 30초마다 부릅니다.
 */
export async function notifyCriticalIssues(now = Date.now()) {
  if (!ensureConfigured()) return { sent: 0, issues: 0 }
  const store = useStore()
  const issues = criticalIssues(now, await todaysActions(now))
  if (issues.length === 0) return { sent: 0, issues: 0 }
  const subscriptions = await store.listPushSubscriptions()
  let sent = 0
  let claimed = 0
  for (const { vehicle, issue } of issues) {
    if (!(await store.claimNotification(issue.id))) continue
    claimed += 1
    const targets = subscriptions.filter((item) => item.role === 'operator' || item.vehicleIds.includes(vehicle.id))
    const payload: PushPayload = {
      title: `위험: ${vehicle.maker} ${vehicle.model}`,
      body: `${issue.title} — ${issue.detail}`,
      url: `/fleet/${vehicle.id}`,
      tag: issue.id,
    }
    const results = await Promise.all(targets.map((target) => deliver(target, payload)))
    sent += results.filter(Boolean).length
  }
  return { sent, issues: claimed }
}

let lastOpportunistic = 0

/** 관제 스트림이 열려 있을 때 30초에 한 번씩 알림을 검사합니다(인스턴스마다). */
export function maybeNotify(now = Date.now()) {
  if (!ensureConfigured() || now - lastOpportunistic < 30_000) return
  lastOpportunistic = now
  void notifyCriticalIssues(now).catch(() => {})
}
