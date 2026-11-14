// KAO 서비스 워커: 웹 푸시만 다룹니다(오프라인 캐시 없음).
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
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === url)
      return open ? open.focus() : self.clients.openWindow(url)
    }),
  )
})
