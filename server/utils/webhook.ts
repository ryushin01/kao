import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns'
import type { LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import type { VehicleSpec } from './fleet-specs'
import { toCommand } from './command'
import type { ActionRecord } from './sim/types'
import { useStore } from './store'
import type { DeviceRecord } from './store/types'

/**
 * 제조사 커넥티드카 API처럼 원격 조치 명령을 장치에 등록한 웹훅 주소로 보냅니다(장치가 받아 가지 않아도 되게).
 * - https만 씁니다. 내부망 주소(사설·루프백·링크 로컬 등)로는 보내지 않습니다. 이름은 연결할 때 확인한 주소로 검사해,
 *   검사한 뒤에 DNS가 바뀌어 내부망으로 향하는 경우(DNS rebinding)도 막습니다.
 * - 리다이렉트는 따르지 않고, 5초 안에 2xx로 응답하면 전달한 것으로 봅니다(그 밖에는 장치가 받아 가기를 기다림).
 * - 서명: X-KAO-Signature: sha256=HMAC-SHA256(비밀, `${X-KAO-Timestamp}.${본문}`). 받는 쪽은 시각이 5분 넘게 다르면 버립니다.
 */

const DEADLINE_MS = 5000

/** 공인 주소인지(사설·예약·루프백·링크 로컬·멀티캐스트·문서용이 아닌지) */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false // 통신사 공유 주소(CGNAT)
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false
    return true
  }
  if (version === 6) {
    const text = address.toLowerCase()
    // IPv4를 담은 IPv6(::ffff:a.b.c.d, NAT64 64:ff9b::a.b.c.d)는 담긴 IPv4로 봅니다.
    const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(text)
    if (embedded) return isPublicAddress(embedded[1]!)
    if (text === '::' || text === '::1') return false
    if (/^f[cd]/.test(text) || /^fe[89ab]/.test(text) || text.startsWith('ff') || text.startsWith('2001:db8') || text.startsWith('::ffff:')) return false
    return true
  }
  return false
}

/** 연결할 때 이름을 풀고, 내부망 주소가 하나라도 있으면 연결하지 않습니다. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    const list = addresses as unknown as LookupAddress[]
    if (error) return callback(error, '', 4)
    if (!list.length || list.some((item) => !isPublicAddress(item.address))) {
      return callback(Object.assign(new Error(`내부망 주소로는 보내지 않습니다: ${hostname}`), { code: 'EBLOCKED' }), '', 4)
    }
    // 연결 쪽이 주소 여러 개(all)를 원하면 목록으로, 아니면 첫 주소로 돌려줍니다.
    if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

export const signWebhook = (secret: string, timestamp: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`

export interface WebhookResult {
  ok: boolean
  status: number | null
  error?: string
}

/** 서명한 본문을 https로 POST합니다. 주소가 https가 아니거나 내부망이면 보내지 않습니다. */
export function postWebhook(url: string, secret: string, body: string, now = Date.now()): Promise<WebhookResult> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return Promise.resolve({ ok: false, status: null, error: '주소 형식이 올바르지 않습니다.' })
  }
  if (target.protocol !== 'https:') return Promise.resolve({ ok: false, status: null, error: 'https 주소만 씁니다.' })
  const host = target.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicAddress(host)) return Promise.resolve({ ok: false, status: null, error: '내부망 주소로는 보내지 않습니다.' })

  const timestamp = String(now)
  return new Promise((resolve) => {
    const req = request(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'user-agent': 'kao-command-webhook (+https://github.com/ryushin01/kao)',
          'x-kao-timestamp': timestamp,
          'x-kao-signature': signWebhook(secret, timestamp, body),
        },
        lookup: safeLookup,
      },
      (response) => {
        response.resume()
        const status = response.statusCode ?? 0
        clearTimeout(deadline)
        resolve({ ok: status >= 200 && status < 300, status })
      },
    )
    const deadline = setTimeout(() => req.destroy(new Error('응답 시간(5초)이 지났습니다.')), DEADLINE_MS)
    req.on('error', (error) => {
      clearTimeout(deadline)
      resolve({ ok: false, status: null, error: error.message })
    })
    req.end(body)
  })
}

/**
 * 실차 명령을 이 탈것의 웹훅 장치들에 보냅니다. 하나라도 받으면 '차량이 받아 간 시각'을 남깁니다.
 * 보내지 못해도 명령은 그대로 있어 장치가 받아 갈 수 있습니다.
 */
export async function deliverCommand(vehicle: VehicleSpec, action: ActionRecord, send = postWebhook) {
  const store = useStore()
  const devices = await store.listWebhookDevices(vehicle.id)
  if (!devices.length) return []
  const body = (device: DeviceRecord) => JSON.stringify({ type: 'kao.command', deviceId: device.id, vehicleId: vehicle.id, command: toCommand(vehicle, action) })
  const results = await Promise.all(
    devices.map(async (device) => ({ deviceId: device.id, ...(await send(device.webhookUrl!, device.webhookSecret ?? '', body(device))) })),
  )
  if (results.some((result) => result.ok)) await store.markCommandDelivered(action.id, Date.now())
  return results
}
