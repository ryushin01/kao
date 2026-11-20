import { abortNavigation, defineNuxtRouteMiddleware, useNuxtApp } from '#imports'

/**
 * 오프라인에서 다른 화면으로 옮기면 앱 안에서 옮기지 않고 그 주소를 새로 엽니다. 앱 안에서 옮기면 화면 데이터를 받지 못해
 * 오류 화면이 되지만, 새로 열면 서비스 워커가 이 기기에 저장한 화면을, 없으면 오프라인 안내 화면을 줍니다.
 * 서비스 워커가 이 화면을 맡고 있을 때만 그렇게 합니다(없으면 브라우저의 연결 오류 화면이 되므로).
 */
export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server || useNuxtApp().isHydrating) return undefined
  if (navigator.onLine || to.path === from.path || !navigator.serviceWorker?.controller) return undefined
  window.location.assign(to.fullPath)
  return abortNavigation()
})
