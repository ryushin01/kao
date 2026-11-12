<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NuxtLink } from '#components'
import { clearNuxtData, navigateTo } from '#imports'
import { formatClock } from '@shared/lib'
import { homePathFor, useSession } from '@entities/session'
import { LogoutButton } from '@features/auth'
import PushToggle from './PushToggle.vue'
import MotionToggle from './MotionToggle.vue'

const session = useSession()
const user = session.user
const now = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

const workspace = computed(() =>
  user.value ? { to: homePathFor(user.value), label: user.value.role === 'operator' ? '관제 센터' : '내 탈것' } : null,
)

onMounted(() => {
  now.value = Date.now()
  timer = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => clearInterval(timer))

async function onLoggedOut() {
  session.setUser(null)
  // 다음 사람이 이전 계정의 관제 데이터를 보지 않도록 받아 둔 데이터를 비웁니다.
  clearNuxtData()
  await navigateTo('/')
}
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
          <li v-if="workspace"><NuxtLink :to="workspace.to">{{ workspace.label }}</NuxtLink></li>
          <li v-else><NuxtLink to="/login">로그인</NuxtLink></li>
        </ul>
      </nav>
      <div class="site-header__tools">
        <p class="site-header__clock hud-label">
          <span>KST</span>
          <span class="tabular">{{ now === null ? '--:--:--' : formatClock(now) }}</span>
        </p>
        <MotionToggle />
        <template v-if="user">
          <PushToggle :public-key="session.pushPublicKey.value" />
          <p class="site-header__user">
            <span class="visually-hidden">로그인: </span>{{ user.name }}
          </p>
          <LogoutButton @done="onLoggedOut" />
        </template>
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
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2) var(--space-3);
  margin-left: auto;
}

.site-header__clock {
  display: flex;
  gap: var(--space-2);
}

.site-header__user {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

@media (width < 60rem) {
  .site-header__full,
  .site-header__clock {
    display: none;
  }
}
</style>
