import { defineEventHandler, setResponseHeader } from 'h3'
import type { ShowroomResponse } from '../../src/shared/api/contract'
import { todaysActions } from '../utils/fleet'
import { computeFrame } from '../utils/sim/engine'

/** 로그인하지 않은 소개 화면용: 모델·도장과 열린 문제 수만 보여 줍니다(위치·회원 정보 제외). */
export default defineEventHandler(async (event): Promise<ShowroomResponse> => {
  const now = Date.now()
  const frame = computeFrame({ now, actions: await todaysActions(now) })
  setResponseHeader(event, 'cache-control', 'public, max-age=5')
  return {
    vehicles: frame.vehicles.map(({ id, modelId, kind, maker, model, paint, speed, metrics }) => ({ id, modelId, kind, maker, model, paint, speed, metrics })),
    summary: {
      vehicles: frame.vehicles.length,
      open: frame.vehicles.flatMap((vehicle) => vehicle.issues).filter((issue) => issue.status === 'open').length,
    },
  }
})
