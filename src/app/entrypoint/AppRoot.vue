<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { NuxtPage } from '#components'
import { useRoute } from '#imports'
import { attachFonts, initMotionPreference } from '@shared/lib'
import { SiteFooter } from '@widgets/site-footer'
import { SiteHeader } from '@widgets/site-header'

const route = useRoute()
const main = ref<HTMLElement | null>(null)

onMounted(initMotionPreference)
// 한글 서울알림체(통파일, 굵기마다 약 0.6MB)는 첫 화면 뒤에 붙입니다. 그 전에는 운영체제 한글 고딕
onMounted(() => attachFonts('/fonts/seoul-alrim.css'))

// 화면을 옮기면 새 본문으로 초점을 보냅니다(화면 낭독기가 이전 화면에 머물지 않게).
watch(
  () => route.path,
  async () => {
    await nextTick()
    main.value?.focus({ preventScroll: true })
  },
)
</script>

<template>
  <a class="skip-link" href="#main">본문 바로가기</a>
  <SiteHeader />
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

.app-main {
  position: relative;
  z-index: 1;
  outline: none;
}
</style>
