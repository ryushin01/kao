<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NuxtLink } from '#components'
import { formatClock } from '@shared/lib'
import MotionToggle from './MotionToggle.vue'

const now = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  now.value = Date.now()
  timer = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <NuxtLink to="/" class="site-header__brand">
        <span class="site-header__mark" aria-hidden="true" />
        <span class="site-header__name">KAO</span>
        <span class="site-header__full">Kinetic Aero One</span>
      </NuxtLink>
      <nav class="site-header__nav" aria-label="주요 메뉴">
        <ul>
          <li><NuxtLink to="/">소개</NuxtLink></li>
          <li><NuxtLink to="/fleet">관제 센터</NuxtLink></li>
        </ul>
      </nav>
      <div class="site-header__tools">
        <p class="site-header__clock hud-label">
          <span>KST</span>
          <span class="tabular">{{ now === null ? '--:--:--' : formatClock(now) }}</span>
        </p>
        <MotionToggle />
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--color-line);
  background: rgb(0 0 0 / 0.78);
  backdrop-filter: blur(10px);
}

.site-header__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-6);
  max-width: var(--content-max);
  min-height: var(--header-height);
  margin: 0 auto;
  padding: var(--space-2) var(--gutter);
}

.site-header__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.75rem;
  text-decoration: none;
}

.site-header__mark {
  width: 1.25rem;
  height: 1.25rem;
  border: 3px solid var(--color-crimson);
  border-radius: 50%;
  box-shadow:
    inset 0 0 0 2px #000,
    inset 0 0 0 3px var(--color-crimson-text);
}

.site-header__name {
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: 0.3em;
}

.site-header__full {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.site-header__nav ul {
  display: flex;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-header__nav a {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  font-size: 0.9375rem;
  text-decoration: none;
  color: var(--color-text-muted);
}

.site-header__nav a:hover,
.site-header__nav a[aria-current='page'] {
  color: var(--color-text);
}

.site-header__nav a[aria-current='page'] {
  box-shadow: inset 0 -2px 0 var(--color-crimson-text);
}

.site-header__tools {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-left: auto;
}

.site-header__clock {
  display: flex;
  gap: var(--space-2);
}

@media (width < 48rem) {
  .site-header__full,
  .site-header__clock {
    display: none;
  }
}
</style>
