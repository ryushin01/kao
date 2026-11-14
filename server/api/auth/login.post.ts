import { createError, defineEventHandler, readBody } from 'h3'
import { verifyPassword } from '../../utils/password'
import { assertSameOrigin, startSession, toSessionUser } from '../../utils/session'
import { useStore } from '../../utils/store'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readBody<{ login?: unknown; password?: unknown }>(event)
  const login = typeof body?.login === 'string' ? body.login.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!login || !password) throw createError({ statusCode: 400, message: '아이디와 비밀번호를 모두 입력해 주세요.' })
  const user = await useStore().findUserByLogin(login)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw createError({ statusCode: 401, message: '아이디 또는 비밀번호가 맞지 않습니다. 아래 데모 계정을 확인해 주세요.' })
  }
  startSession(event, user.id)
  return { user: toSessionUser(user) }
})
