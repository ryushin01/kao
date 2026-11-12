import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { notifyCriticalIssues } from '../../utils/push'

/** GitHub Actions(.github/workflows/notify.yml)가 5분마다 부릅니다. Authorization: Bearer $CRON_SECRET */
export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET
  if (!secret || getRequestHeader(event, 'authorization') !== `Bearer ${secret}`) {
    throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다.' })
  }
  return notifyCriticalIssues()
})
