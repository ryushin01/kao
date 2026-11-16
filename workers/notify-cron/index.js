/**
 * KAO 위험 알림 크론. 5분마다 운영 서버의 /api/cron/notify를 부르기만 하고,
 * 위험 등급의 열린 문제를 웹 푸시로 알리는 일(누구에게 무엇을 한 번만 보낼지)은 서버가 합니다.
 *
 * 알림을 받는 구독이 하나도 없으면 서버가 { subscriptions: 0 }으로 답합니다. 그때는 1시간 동안(KV `GATE`에 기억)
 * 서버를 부르지 않아, 무료 Neon DB가 5분마다 깨지 않고 잠들 수 있게 합니다. 새로 구독한 사람은 관제 화면을 연 동안
 * 스트림이 30초마다 검사하고, 크론은 기억이 끝나면(길어야 1시간) 다시 부릅니다. 한국 시간 4시대(서버가 오래된 기록을
 * 지우는 때)에는 기억과 상관없이 부릅니다.
 *
 * env.SITE_URL: wrangler.toml의 [vars], env.CRON_SECRET: `wrangler secret put CRON_SECRET`(Vercel·GitHub와 같은 값),
 * env.GATE: KV 네임스페이스(없으면 기억하지 않고 늘 부름)
 */
const GATE_KEY = 'no-subscribers'
const GATE_MS = 60 * 60_000

export default {
  /** @param {{ scheduledTime: number }} controller @param {Env} env @param {{ waitUntil: (promise: Promise<unknown>) => void }} context */
  async scheduled(controller, env, context) {
    context.waitUntil(callNotify(env, controller.scheduledTime))
  },
}

/** @typedef {{ SITE_URL: string; CRON_SECRET: string; GATE?: { get: (key: string, type: 'json') => Promise<unknown>; put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>; delete: (key: string) => Promise<void> } }} Env */

/** 서버가 오래된 기록을 지우는 때(한국 시간 4시부터 10분, server/utils/retention.ts와 같음) */
function isPruneWindow(time) {
  const kst = (time + 9 * 3600_000) % 86_400_000
  return kst >= 4 * 3600_000 && kst < 4 * 3600_000 + 10 * 60_000
}

/** @param {Env} env @param {number} scheduledTime */
async function callNotify(env, scheduledTime) {
  const gate = env.GATE ? /** @type {{ until?: number } | null} */ (await env.GATE.get(GATE_KEY, 'json')) : null
  if (gate?.until && gate.until > scheduledTime && !isPruneWindow(scheduledTime)) {
    console.log(JSON.stringify({ scheduled: new Date(scheduledTime).toISOString(), skipped: 'no-subscribers', until: new Date(gate.until).toISOString() }))
    return
  }
  const response = await fetch(new URL('/api/cron/notify', env.SITE_URL), {
    headers: { authorization: `Bearer ${env.CRON_SECRET}`, 'user-agent': 'kao-notify-cron' },
    signal: AbortSignal.timeout(25_000),
  })
  const body = await response.text()
  // 결과는 `wrangler tail`과 Cloudflare 대시보드의 로그로 봅니다. 실패하면 예외로 남겨 실행 기록에 오류로 보이게 합니다.
  console.log(JSON.stringify({ scheduled: new Date(scheduledTime).toISOString(), status: response.status, body: body.slice(0, 200) }))
  if (!response.ok) throw new Error(`/api/cron/notify ${response.status}`)
  if (!env.GATE) return
  let subscriptions = null
  try {
    subscriptions = JSON.parse(body).subscriptions ?? null
  } catch {
    // 모르는 형식이면 기억하지 않습니다.
  }
  if (subscriptions === 0) {
    await env.GATE.put(GATE_KEY, JSON.stringify({ until: scheduledTime + GATE_MS }), { expirationTtl: Math.ceil(GATE_MS / 1000) + 60 })
  } else if (gate) {
    await env.GATE.delete(GATE_KEY)
  }
}
