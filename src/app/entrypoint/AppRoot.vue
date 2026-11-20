<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { NuxtPage } from '#components'
import { useRoute } from '#imports'
import { attachFonts, initMotionPreference, initOnlineStatus, registerOfflineSupport, savePageForOffline, useOnline } from '@shared/lib'
import { SiteFooter } from '@widgets/site-footer'
import { SiteHeader } from '@widgets/site-header'

const route = useRoute()
const main = ref<HTMLElement | null>(null)
const online = useOnline()

onMounted(initMotionPreference)
// 한글 나머지 글자 조각(화면 글자 파일에 없는 글자)은 첫 화면 뒤에 붙입니다.
onMounted(() => {
  attachFonts('/fonts/kao-sans-rest.css')
  attachFonts('/fonts/orbit-rest.css')
})
// 오프라인 저장: 연 화면과 지도·모델·글꼴을 이 기기에 저장해 연결이 끊겨도 보여 줍니다.
// 개발 서버에서는 등록하지 않습니다(고친 모듈 대신 저장해 둔 옛 파일이 나오지 않게).
onMounted(() => {
  initOnlineStatus()
  if (!import.meta.dev) void registerOfflineSupport()
})

// 화면을 옮기면 새 본문으로 초점을 보내고(화면 낭독기가 이전 화면에 머물지 않게), 새 화면을 오프라인용으로 저장합니다.
watch(
  () => route.path,
  async () => {
    await nextTick()
    main.value?.focus({ preventScroll: true })
    void savePageForOffline()
  },
)
</script>

<template>
  <a class="skip-link" href="#main">본문 바로가기</a>
  <SiteHeader />
  <!-- 알림 영역은 늘 두고 글자만 바꿉니다(처음부터 있어야 화면 낭독기가 바뀐 내용을 읽음). -->
  <p class="offline-notice" role="status">
    <template v-if="!online">
      오프라인입니다. 마지막으로 받은 화면을 보여 드리며, 실시간 위치와 원격 조치는 다시 연결되면 이어집니다.
    </template>
  </p>
  <main id="main" ref="main" tabindex="-1" class="app-main">
    <NuxtPage />
  </main>
  <SiteFooter />
</template>

<style scoped>
.skip-link {
  position: fixed;
  top: var(--space-2);
  left: var(--space-2);
  z-index: 100;
  padding: var(--space-3) var(--space-4);
  background: var(--color-crimson);
  color: #fff;
  font-weight: 600;
  transform: translateY(-200%);
}

.skip-link:focus {
  transform: none;
}

.offline-notice {
  position: relative;
  z-index: 2;
  margin: 0;
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-warning);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-size: 0.875rem;
  text-align: center;
}

.offline-notice:empty {
  padding: 0;
  border: 0;
}

.app-main {
  position: relative;
  z-index: 1;
  outline: none;
}
</style>
