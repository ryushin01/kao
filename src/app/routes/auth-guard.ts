import { defineNuxtRouteMiddleware, navigateTo } from '#imports'
import { homePathFor, useSession } from '@entities/session'

/**
 * 화면 접근 규칙
 * - /login: 이미 로그인했으면 역할별 첫 화면으로
 * - /fleet: 관제 요원만. 회원은 자기 탈것으로
 * - /fleet/:id: 관제 요원이나 그 탈것의 회원만
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSession()
  const { user } = await session.ensure()

  if (to.path === '/login') {
    return user ? navigateTo(homePathFor(user)) : undefined
  }
  if (!to.path.startsWith('/fleet')) return undefined
  if (!user) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })

  const vehicleId = typeof to.params.id === 'string' ? to.params.id : null
  if (!vehicleId) return user.role === 'operator' ? undefined : navigateTo(homePathFor(user))
  // 없는 탈것은 관제 요원에게 404를 보여 주고, 회원은 자기 탈것으로 보냅니다.
  if (user.role === 'member' && !user.vehicleIds.includes(vehicleId)) return navigateTo(homePathFor(user))
  return undefined
})
