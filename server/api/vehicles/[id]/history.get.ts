import { createError, defineEventHandler, getQuery, getRouterParam, setResponseHeader } from 'h3'
import type { HistoryResponse } from '../../../../src/shared/api/contract'
import { todaysActions } from '../../../utils/fleet'
import { useStore } from '../../../utils/store'
import { computeHistory, dayStartOf } from '../../../utils/sim/engine'
import { LIVE_READING_MAX_AGE } from '../../../utils/sim/live'
import { requireUser } from '../../../utils/session'

const RANGES = new Set([10, 30, 60])
const POINTS = 120

/** 지표 이력. 실차 측정값이 있던 시각은 그 값을, 없던 시각은 시뮬레이션을 다시 계산해 씁니다. */
export default defineEventHandler(async (event): Promise<HistoryResponse> => {
  const user = await requireUser(event)
  const vehicleId = getRouterParam(event, 'id') ?? ''
  if (!user.vehicleIds.includes(vehicleId)) throw createError({ statusCode: 404, message: '볼 수 없는 탈것입니다.' })
  const query = getQuery(event)
  const minutes = Number(query.minutes ?? 10)
  const metricKey = String(query.metric ?? '')
  if (!RANGES.has(minutes)) throw createError({ statusCode: 400, message: '기간은 10, 30, 60분 중 하나로 골라 주세요.' })

  const to = Date.now()
  const from = to - minutes * 60_000
  // 기간이 0시를 지나면 전날 조치 기록도 필요합니다.
  const [actions, readings] = await Promise.all([
    dayStartOf(from) === dayStartOf(to) ? todaysActions(to) : useStore().listActionsSince(dayStartOf(from)),
    useStore().listVehicleReadings(vehicleId, from - LIVE_READING_MAX_AGE, to),
  ])
  const result = computeHistory({ vehicleId, metricKey, from, to, points: POINTS, actions, readings })
  if (!result) throw createError({ statusCode: 404, message: '이 탈것에 없는 지표입니다.' })
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return { vehicleId, metric: result.metric, from, to, samples: result.samples, liveSamples: result.liveSamples }
})
