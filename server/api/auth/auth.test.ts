// @vitest-environment node
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, send, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LOGIN_LIMIT_PER_ACCOUNT, LOGIN_LIMIT_PER_ADDRESS, LOGIN_WINDOW_MS } from '../../utils/login-guard'
import { encodeSessionCookie } from '../../utils/session'
import login from './login.post'
import logout from './logout.post'
import session from './session.get'

let server: Server
let base = ''

beforeAll(async () => {
  // Vercel처럼 x-forwarded-for를 요청 주소로 믿게 해, 시험마다 다른 주소로 보냅니다(서로의 시도 수가 섞이지 않게).
  vi.stubEnv('VERCEL', '1')
  // Nitro처럼 오류 응답 본문에 message를 담습니다(h3만 쓰면 statusCode만 담음).
  const app = createApp({
    onError: (error, event) => {
      setResponseStatus(event, error.statusCode)
      return send(event, JSON.stringify({ statusCode: error.statusCode, message: error.message }), 'application/json')
    },
  })
  app.use('/api/auth/login', login)
  app.use('/api/auth/logout', logout)
  app.use('/api/auth/session', session)
  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
  vi.unstubAllEnvs()
})

const post = (path: string, body: unknown, headers: Record<string, string> = {}, address = '10.0.0.1') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address, ...headers },
    body: JSON.stringify(body),
  })

const sessionCookie = (response: Response) => /kao_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''

const currentUser = async (cookie: string) =>
  ((await (await fetch(`${base}/api/auth/session`, { headers: { cookie: `kao_session=${cookie}` } })).json()) as { user: { login: string } | null }).user

describe('로그인 세션', () => {
  it('로그인하면 서버 세션이 생기고, 로그아웃하면 같은 쿠키를 다시 보내도 끝난 세션입니다', async () => {
    const response = await post('/api/auth/login', { login: 'operator', password: 'kao-demo-2026' })
    expect(response.status).toBe(200)
    const cookie = sessionCookie(response)
    expect(cookie).toMatch(/^[\w-]+\.[\w-]+$/)
    expect((await currentUser(cookie))?.login).toBe('operator')

    // 같은 계정의 다른 세션(다른 사람이 같은 데모 계정을 씀)은 로그아웃해도 그대로입니다.
    const other = sessionCookie(await post('/api/auth/login', { login: 'operator', password: 'kao-demo-2026' }))
    expect((await post('/api/auth/logout', {}, { cookie: `kao_session=${cookie}` })).status).toBe(200)
    expect(await currentUser(cookie)).toBeNull()
    expect((await currentUser(other))?.login).toBe('operator')
  })

  it('서명은 맞아도 저장소에 없는 세션(0.15.0까지의 쿠키 등)은 로그인하지 않은 것으로 봅니다', async () => {
    expect(await currentUser(encodeSessionCookie('eyJ1aWQiOiJ1c2VyLW9wZXJhdG9yIn0'))).toBeNull()
  })

  it('다른 사이트나 주소로 읽을 수 없는 출처(Origin: null)의 로그인은 403입니다', async () => {
    for (const origin of ['null', 'https://evil.example']) {
      expect((await post('/api/auth/login', { login: 'operator', password: 'kao-demo-2026' }, { origin })).status).toBe(403)
    }
  })
})

describe('로그인 시도 제한', () => {
  it('같은 아이디·주소로 여러 번 틀리면 맞는 비밀번호도 잠시 막고(429), 다른 아이디나 다른 주소는 막지 않습니다', async () => {
    const address = '10.0.1.1'
    for (let i = 0; i < LOGIN_LIMIT_PER_ACCOUNT; i += 1) {
      expect((await post('/api/auth/login', { login: 'member02', password: `wrong-${i}` }, {}, address)).status).toBe(401)
    }
    const blocked = await post('/api/auth/login', { login: 'member02', password: 'kao-demo-2026' }, {}, address)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe(String(LOGIN_WINDOW_MS / 1000))
    expect(((await blocked.json()) as { message: string }).message).toContain('15분')
    expect((await post('/api/auth/login', { login: 'member03', password: 'kao-demo-2026' }, {}, address)).status).toBe(200)
    // 남이 일부러 틀려도 다른 주소의 사람은 같은 데모 계정으로 들어갑니다.
    expect((await post('/api/auth/login', { login: 'member02', password: 'kao-demo-2026' }, {}, '10.0.1.2')).status).toBe(200)
  })

  it('틀린 요청이 한꺼번에 몰려도 비밀번호는 제한 수만큼만 확인하고 나머지는 막습니다', async () => {
    const statuses = await Promise.all(
      Array.from({ length: LOGIN_LIMIT_PER_ACCOUNT * 3 }, (_, i) =>
        post('/api/auth/login', { login: 'member05', password: `burst-${i}` }, {}, '10.0.2.1').then((response) => response.status),
      ),
    )
    expect(statuses.filter((status) => status === 401)).toHaveLength(LOGIN_LIMIT_PER_ACCOUNT)
    expect(statuses.filter((status) => status === 429)).toHaveLength(LOGIN_LIMIT_PER_ACCOUNT * 2)
  })

  it('한 주소에서 여러 아이디로 틀리면 주소 제한으로 막고, 성공한 로그인은 주소의 시도 수에 쌓이지 않습니다', async () => {
    const address = '10.0.3.1'
    // 성공은 몇 번이든 주소 제한에 닿지 않습니다.
    for (let i = 0; i < LOGIN_LIMIT_PER_ADDRESS + 5; i += 1) {
      expect((await post('/api/auth/login', { login: 'member06', password: 'kao-demo-2026' }, {}, address)).status).toBe(200)
    }
    for (let i = 0; i < LOGIN_LIMIT_PER_ADDRESS; i += 1) {
      expect((await post('/api/auth/login', { login: `guess-${i}`, password: 'x' }, {}, address)).status).toBe(401)
    }
    expect((await post('/api/auth/login', { login: 'member06', password: 'kao-demo-2026' }, {}, address)).status).toBe(429)
  })

  it('없는 아이디도 실패로 세고 같은 문구로 답합니다', async () => {
    const unknown = await post('/api/auth/login', { login: 'nobody', password: 'x' }, {}, '10.0.4.1')
    const wrong = await post('/api/auth/login', { login: 'member04', password: 'x' }, {}, '10.0.4.1')
    expect(unknown.status).toBe(401)
    expect(((await unknown.json()) as { message: string }).message).toBe(((await wrong.json()) as { message: string }).message)
  })
})
