/**
 * KAO 위험 알림 크론. 5분마다 운영 서버의 /api/cron/notify를 부르기만 하고,
 * 위험 등급의 열린 문제를 웹 푸시로 알리는 일(누구에게 무엇을 한 번만 보낼지)은 서버가 합니다.
 *
 * env.SITE_URL: wrangler.toml의 [vars], env.CRON_SECRET: `wrangler secret put CRON_SECRET`(Vercel·GitHub와 같은 값)
 */
export default {
  /** @param {{ scheduledTime: number }} controller @param {{ SITE_URL: string; CRON_SECRET: string }} env @param {{ waitUntil: (promise: Promise<unknown>) => void }} context */
  async scheduled(controller, env, context) {
    context.waitUntil(callNotify(env, controller.scheduledTime))
  },
}

/** @param {{ SITE_URL: string; CRON_SECRET: string }} env @param {number} scheduledTime */
async function callNotify(env, scheduledTime) {
  const response = await fetch(new URL('/api/cron/notify', env.SITE_URL), {
    headers: { authorization: `Bearer ${env.CRON_SECRET}`, 'user-agent': 'kao-notify-cron' },
    signal: AbortSignal.timeout(25_000),
  })
  const body = await response.text()
  // 결과는 `wrangler tail`과 Cloudflare 대시보드의 로그로 봅니다. 실패하면 예외로 남겨 실행 기록에 오류로 보이게 합니다.
  console.log(JSON.stringify({ scheduled: new Date(scheduledTime).toISOString(), status: response.status, body: body.slice(0, 200) }))
  if (!response.ok) throw new Error(`/api/cron/notify ${response.status}`)
}
