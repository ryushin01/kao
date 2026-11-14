import { defineEventHandler, getQuery } from 'h3'
import { authenticateIngest, vehicleIdFor } from '../../utils/devices'
import { findIngestVehicle, toCommand } from '../../utils/ingest'
import { useStore } from '../../utils/store'

/**
 * 측정값을 보내지 않고 명령만 확인하는 장치용. GET /api/ingest/commands?vehicleId=kao-0001
 * 응답 시간(2분)이 남은, 아직 응답하지 않은 명령을 돌려주고 받아 간 시각을 남깁니다.
 */
export default defineEventHandler(async (event) => {
  const principal = await authenticateIngest(event)
  const vehicle = findIngestVehicle(vehicleIdFor(principal, getQuery(event).vehicleId))
  const commands = await useStore().takeCommands(vehicle.id, Date.now())
  return { vehicleId: vehicle.id, commands: commands.map((command) => toCommand(vehicle, command)) }
})
