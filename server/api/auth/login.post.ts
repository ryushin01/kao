import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3'
import { isLoginBlocked, LOGIN_WINDOW_MS, loginFailureKeys } from '../../utils/login-guard'
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../../utils/password'
import { assertSameOrigin, clientAddress, startSession, toSessionUser } from '../../utils/session'
import { useStore } from '../../utils/store'

/**
 * 로그인. 실패가 쌓이면 잠시 막고(login-guard.ts), 없는 아이디도 같은 비용으로 해시를 확인해
 * 응답 시간으로 계정이 있는지 알 수 없게 합니다.
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readBody<{ login?: unknown; password?: unknown }>(event)
  const login = typeof body?.login === 'string' ? body.login.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!login || !password) throw createError({ statusCode: 400, message: '아이디와 비밀번호를 모두 입력해 주세요.' })

  const store = useStore()
  const now = Date.now()
  const keys = loginFailureKeys(login, clientAddress(event))
  if (isLoginBlocked(await store.countLoginFailures([keys.account, keys.address], now - LOGIN_WINDOW_MS), keys)) {
    setResponseHeader(event, 'retry-after', LOGIN_WINDOW_MS / 1000)
    throw createError({
      statusCode: 429,
      message: '로그인에 여러 번 실패해 잠시 막았습니다. 15분 안에 다시 시도할 수 있습니다. 아래 데모 계정을 확인해 주세요.',
    })
  }

  const user = await store.findUserByLogin(login)
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
  if (!user || !valid) {
    await store.recordLoginFailure([keys.account, keys.address], now)
    throw createError({ statusCode: 401, message: '아이디 또는 비밀번호가 맞지 않습니다. 아래 데모 계정을 확인해 주세요.' })
  }
  await store.clearLoginFailures(keys.account)
  await startSession(event, user.id, now)
  return { user: toSessionUser(user) }
})
