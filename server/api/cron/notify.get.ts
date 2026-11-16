import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { notifyCriticalIssues } from '../../utils/push'

/** Cloudflare Workers 크론(workers/notify-cron)이 5분마다 부릅니다. Authorization: Bearer $CRON_SECRET */
export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET
  if (!secret || getRequestHeader(event, 'authorization') !== `Bearer ${secret}`) {
    throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다.' })
  }
  return notifyCriticalIssues()
})
