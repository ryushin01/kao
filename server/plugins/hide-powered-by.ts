import { defineNitroPlugin } from 'nitropack/runtime'

/** Nuxt가 화면 응답에 붙이는 X-Powered-By를 뺍니다(쓰는 프레임워크를 알리지 않음). 보안 헤더는 nuxt.config.ts의 routeRules에 있습니다. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response) => {
    if (response.headers) delete response.headers['x-powered-by']
  })
})
