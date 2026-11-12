<script setup lang="ts">
import { navigateTo, useHead, useRoute } from '#imports'
import type { SessionUser } from '@shared/api'
import { HudPanel } from '@shared/ui'
import { homePathFor, useSession } from '@entities/session'
import { LoginForm } from '@features/auth'

useHead({ title: '로그인 — KAO' })

const route = useRoute()
const session = useSession()

async function onSuccess(user: SessionUser) {
  session.setUser(user)
  await session.refresh()
  // 같은 사이트 안의 경로로만 돌아갑니다(열린 리디렉트 방지).
  const redirect = typeof route.query.redirect === 'string' && /^\/(?!\/)/.test(route.query.redirect) ? route.query.redirect : null
  await navigateTo(redirect ?? homePathFor(user))
}
</script>

<template>
  <div class="login-page">
    <HudPanel as="div" class="login-page__panel">
      <p class="hud-label">Access</p>
      <h1 class="login-page__title">로그인</h1>
      <p class="login-page__lead">관제 요원은 등록된 4대 전체를, 회원은 자기 탈것의 상태와 알림을 봅니다.</p>
      <LoginForm @success="onSuccess" />
    </HudPanel>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  place-items: start center;
  min-height: calc(100svh - var(--header-height));
  padding: var(--space-12) var(--gutter);
}

.login-page__panel {
  display: grid;
  gap: var(--space-4);
  width: min(100%, 34rem);
}

.login-page__title {
  font-size: clamp(2rem, 6vw, 3rem);
  font-weight: 800;
}

.login-page__lead {
  color: var(--color-text-muted);
}
</style>
