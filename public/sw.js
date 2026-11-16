// KAO 서비스 워커: 웹 푸시만 다룹니다(오프라인 캐시 없음, fetch 처리기 없음).

// 새 버전(알림 아이콘 등)을 기다리지 않고 바로 쓰고, 열려 있는 KAO 창도 바로 맡습니다(알림을 누르면 그 창을 옮기려고).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = { title: 'KAO', body: '', url: '/', tag: 'kao' }
  try {
    data = { ...data, ...event.data.json() }
  } catch {
    // 형식이 다르면 기본 문구를 씁니다.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      // 안드로이드 크롬은 SVG 아이콘을 쓰지 못합니다. 배지는 알림 표시줄용 흰 단색 PNG입니다.
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      lang: 'ko',
      data: { url: data.url },
    }),
  )
})

// 알림을 누르면 그 화면이 열린 창을, 없으면 열려 있는 KAO 창을 그 화면으로 옮기고, 창이 없으면 새로 엽니다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const exact = windows.find((client) => client.url === url)
      if (exact) return exact.focus()
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        try {
          const moved = await open.navigate(url)
          return (moved ?? open).focus()
        } catch {
          // 이 서비스 워커가 맡지 않은 창은 옮길 수 없어 새로 엽니다.
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
