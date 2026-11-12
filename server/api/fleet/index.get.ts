import { defineEventHandler, setResponseHeader } from 'h3'
import { useFleetEngine } from '../../utils/fleet'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return useFleetEngine().frame()
})
