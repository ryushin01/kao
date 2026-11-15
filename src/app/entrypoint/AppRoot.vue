<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { NuxtPage } from '#components'
import { useHead, useRoute } from '#imports'
import { initMotionPreference } from '@shared/lib'
import { SiteFooter } from '@widgets/site-footer'
import { SiteHeader } from '@widgets/site-header'
import { FONT_FACE_CSS, FONT_FILES, FONT_LOADER_SCRIPT } from './font-loader'

const route = useRoute()
const main = ref<HTMLElement | null>(null)

onMounted(initMotionPreference)
// 한글 서울알림체(통파일): 글꼴 정의를 바로 넣고 파일을 먼저 받기 시작해, 다 받을 때까지 로딩 화면을 덮습니다.
useHead({
  link: FONT_FILES.map((href) => ({ rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: '' })),
  // 글꼴 정의가 상태 스크립트보다 먼저 와야 document.fonts.load가 이 글꼴을 기다립니다.
  style: [{ key: 'seoul-alrim', innerHTML: FONT_FACE_CSS, tagPriority: 'critical' }],
  script: [{ key: 'font-loader', innerHTML: FONT_LOADER_SCRIPT, tagPosition: 'head', tagPriority: 'low' }],
})

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
  <div class="font-loader" role="status">
    <span class="font-loader__radar" aria-hidden="true" />
    <p class="font-loader__text">
      <span class="font-loader__brand" aria-hidden="true">KAO</span>
      관제 신호를 잡는 중입니다
    </p>
  </div>
  <a class="skip-link" href="#main">본문 바로가기</a>
  <SiteHeader />
  <main id="main" ref="main" tabindex="-1" class="app-main">
    <NuxtPage />
  </main>
  <SiteFooter />
</template>

<style>
/*
 * 글꼴 로딩 화면: 서울알림체를 다 받을 때까지 검은 관제 화면에 신호가 퍼집니다.
 * html[data-fonts="loading"]일 때만 보이고, 받는 동안 뒤의 내용은 숨겨 초점이 들어가지 않게 합니다.
 */
.font-loader {
  display: none;
}

[data-fonts='loading'] .font-loader {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 32px;
  background: var(--color-void);
  color: var(--color-text);
}

[data-fonts='loading'] body :where(#__nuxt) > :not(.font-loader) {
  visibility: hidden;
}

.font-loader__radar {
  position: relative;
  width: 96px;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px solid var(--color-line-strong);
  background: radial-gradient(circle, var(--color-crimson-text) 0 4px, transparent 5px);
}

.font-loader__radar::before,
.font-loader__radar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--color-crimson-text);
  animation: font-loader-ping 1.8s cubic-bezier(0, 0.4, 0.4, 1) infinite;
}

.font-loader__radar::after {
  animation-delay: 0.9s;
}

.font-loader__text {
  display: grid;
  gap: 8px;
  margin: 0;
  font-size: 0.875rem;
  letter-spacing: 0.04em;
  text-align: center;
}

.font-loader__brand {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.4em;
  color: var(--color-crimson-text);
}

@keyframes font-loader-ping {
  from {
    scale: 0.1;
    opacity: 1;
  }
  to {
    scale: 1;
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .font-loader__radar::before,
  .font-loader__radar::after {
    animation: none;
    opacity: 0.4;
  }

  .font-loader__radar::after {
    scale: 0.55;
  }
}
</style>

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
