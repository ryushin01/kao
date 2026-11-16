import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { notifyCriticalIssues } from '../../utils/push'

/** 길이가 달라도 같은 시간에 비교하도록 해시끼리 견줍니다. */
const sameSecret = (actual: string, expected: string) =>
  timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest())

/** Cloudflare Workers 크론(workers/notify-cron)이 5분마다 부릅니다. Authorization: Bearer $CRON_SECRET */
export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !sameSecret(getRequestHeader(event, 'authorization') ?? '', `Bearer ${secret}`)) {
    throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다.' })
  }
  return notifyCriticalIssues()
})
