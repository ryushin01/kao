// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { VEHICLE_SPECS } from './fleet-specs'
import { hashToken } from './devices'
import { useStore } from './store'
import { deliverCommand, isPublicAddress, postWebhook, signWebhook } from './webhook'
import type { WebhookResult } from './webhook'

describe('isPublicAddress', () => {
  it('사설·루프백·링크 로컬·CGNAT·멀티캐스트·문서용 주소는 내부망으로 봅니다', () => {
    for (const address of ['10.1.2.3', '127.0.0.1', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.10']) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    for (const address of ['::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::192.168.0.1']) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('공인 주소는 통과합니다', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
    expect(isPublicAddress('not-an-ip')).toBe(false)
  })
})

describe('postWebhook', () => {
  it('https가 아니거나 내부망 주소면 보내지 않습니다(이름이 내부망으로 풀려도)', async () => {
    expect(await postWebhook('http://example.com/hook', 's', '{}')).toMatchObject({ ok: false, error: 'https 주소만 씁니다.' })
    expect(await postWebhook('https://127.0.0.1/hook', 's', '{}')).toMatchObject({ ok: false, error: '내부망 주소로는 보내지 않습니다.' })
    expect(await postWebhook('https://[::1]/hook', 's', '{}')).toMatchObject({ ok: false, error: '내부망 주소로는 보내지 않습니다.' })
    expect(await postWebhook('not a url', 's', '{}')).toMatchObject({ ok: false })
    const resolved = await postWebhook('https://localhost:9/hook', 's', '{}')
    expect(resolved.ok).toBe(false)
    expect(resolved.error).toMatch(/내부망 주소로는 보내지 않습니다: localhost/)
  })

  it('서명은 HMAC-SHA256(비밀, 시각.본문)입니다', () => {
    const expected = createHmac('sha256', 'secret').update('1700000000000.{"a":1}').digest('hex')
    expect(signWebhook('secret', '1700000000000', '{"a":1}')).toBe(`sha256=${expected}`)
  })
})

describe('deliverCommand', () => {
  it('웹훅 장치에 명령을 보내고, 받으면 차량이 받아 간 시각을 남깁니다', async () => {
    const store = useStore()
    const vehicle = VEHICLE_SPECS.find((item) => item.id === 'kao-0003')!
    await store.insertDevice({
      id: 'dev-hook',
      vehicleId: vehicle.id,
      name: '제조사 연동',
      tokenHash: hashToken('kaod_hook'),
      createdAt: 0,
      revokedAt: null,
      lastSeenAt: null,
      webhookUrl: 'https://maker.example/kao/commands',
      webhookSecret: 'hook-secret',
    })
    const action = { id: 'cmd-1', issueId: `live-${vehicle.id}-coolant-1`, vehicleId: vehicle.id, action: 'cooling-mode' as const, sentAt: 5_000 }
    await store.insertAction({ ...action, userId: 'user-operator' })

    const send = vi.fn(async (): Promise<WebhookResult> => ({ ok: true, status: 202 }))
    const results = await deliverCommand(vehicle, action, send)
    expect(results).toEqual([{ deviceId: 'dev-hook', ok: true, status: 202 }])
    const [url, secret, body] = send.mock.calls[0] as unknown as [string, string, string]
    expect(url).toBe('https://maker.example/kao/commands')
    expect(secret).toBe('hook-secret')
    expect(JSON.parse(body)).toMatchObject({ type: 'kao.command', deviceId: 'dev-hook', vehicleId: vehicle.id, command: { id: 'cmd-1', action: 'cooling-mode' } })
    const saved = (await store.listActionsSince(0)).find((item) => item.id === 'cmd-1')!
    expect(saved.deliveredAt).not.toBeNull()
    expect(saved.deliveredAt).toBeGreaterThan(0)
  })

  it('장치가 받지 못하면(2xx가 아니면) 받아 간 시각을 남기지 않고, 명령은 장치가 받아 갈 수 있게 둡니다', async () => {
    const store = useStore()
    const vehicle = VEHICLE_SPECS.find((item) => item.id === 'kao-0001')!
    await store.insertDevice({
      id: 'dev-down',
      vehicleId: vehicle.id,
      name: '응답 없는 연동',
      tokenHash: hashToken('kaod_down'),
      createdAt: 0,
      revokedAt: null,
      lastSeenAt: null,
      webhookUrl: 'https://maker.example/down',
      webhookSecret: 's',
    })
    const action = { id: 'cmd-3', issueId: `live-${vehicle.id}-coolant-2`, vehicleId: vehicle.id, action: 'cooling-mode' as const, sentAt: Date.now() }
    await store.insertAction({ ...action, userId: 'user-operator' })
    const results = await deliverCommand(vehicle, action, async () => ({ ok: false, status: 503 }))
    expect(results).toEqual([{ deviceId: 'dev-down', ok: false, status: 503 }])
    expect((await store.listActionsSince(0)).find((item) => item.id === 'cmd-3')!.deliveredAt ?? null).toBeNull()
    expect((await store.takeCommands(vehicle.id, Date.now())).map((item) => item.id)).toContain('cmd-3')
  })

  it('웹훅 장치가 없으면 보내지 않습니다', async () => {
    const vehicle = VEHICLE_SPECS.find((item) => item.id === 'kao-0004')!
    const send = vi.fn(async (): Promise<WebhookResult> => ({ ok: false, status: 500 }))
    expect(await deliverCommand(vehicle, { id: 'cmd-2', issueId: 'live-x', vehicleId: vehicle.id, action: 'notify-rider', sentAt: 1 }, send)).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })
})
