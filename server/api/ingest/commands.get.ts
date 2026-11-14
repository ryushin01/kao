import { defineEventHandler, getQuery } from 'h3'
import { findIngestVehicle, requireIngestToken, toCommand } from '../../utils/ingest'
import { useStore } from '../../utils/store'

/**
 * 측정값을 보내지 않고 명령만 확인하는 장치용. GET /api/ingest/commands?vehicleId=kao-0001
 * 응답 시간(2분)이 남은, 아직 응답하지 않은 명령을 돌려주고 받아 간 시각을 남깁니다.
 */
export default defineEventHandler(async (event) => {
  requireIngestToken(event)
  const vehicle = findIngestVehicle(getQuery(event).vehicleId)
  const commands = await useStore().takeCommands(vehicle.id, Date.now())
  return { vehicleId: vehicle.id, commands: commands.map((command) => toCommand(vehicle, command)) }
})
