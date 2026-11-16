import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { notifyCriticalIssues } from '../../utils/push'
import { isPruneWindow } from '../../utils/retention'
import { useStore } from '../../utils/store'

/** 길이가 달라도 같은 시간에 비교하도록 해시끼리 견줍니다. */
const sameSecret = (actual: string, expected: string) =>
  timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest())

/** Cloudflare Workers 크론(workers/notify-cron)이 5분마다 부릅니다. Authorization: Bearer $CRON_SECRET */
export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !sameSecret(getRequestHeader(event, 'authorization') ?? '', `Bearer ${secret}`)) {
    throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다.' })
  }
  const now = Date.now()
  const result = await notifyCriticalIssues(now)
  // 하루 한 번(한국 시간 4시대) 오래된 기록을 지웁니다. 배포가 뜸해도 DB에 쌓이지 않게(배포 빌드도 지움).
  let pruned = false
  if (isPruneWindow(now)) {
    pruned = await useStore()
      .pruneRecords(now)
      .then(() => true)
      .catch((error: unknown) => {
        console.error('[cron/notify] 오래된 기록을 지우지 못했습니다:', error)
        return false
      })
  }
  return { ...result, pruned }
})
