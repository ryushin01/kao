<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useHead } from '#imports'
import { initMotionPreference } from '@shared/lib'
import { SiteFooter } from '@widgets/site-footer'
import { SiteHeader } from '@widgets/site-header'
import { EventHorizon } from '@widgets/event-horizon'

/** Nuxt 오류 화면. 앱 레이아웃 밖에서 그려지므로 헤더와 푸터를 직접 둡니다. */
const props = defineProps<{ error: { statusCode?: number; statusMessage?: string } }>()

const notFound = computed(() => props.error.statusCode === 404)
const heading = computed(() => (notFound.value ? '사건의 지평선 너머로 사라진 화면입니다' : '관제 신호가 끊겼습니다'))

// 오류 화면은 AppRoot 밖에서 그려지므로 동작 줄이기 설정을 여기서도 읽습니다.
onMounted(initMotionPreference)

useHead({ title: () => `${notFound.value ? '찾을 수 없음' : '오류'} — KAO` })
</script>

<template>
  <a class="skip-link" href="#main">본문 바로가기</a>
  <SiteHeader />
  <main id="main" class="not-found">
    <EventHorizon />
    <div class="not-found__body">
      <p class="hud-label">Signal lost · {{ error.statusCode ?? 500 }}</p>
      <h1 class="not-found__title">{{ heading }}</h1>
      <p class="not-found__text">
        {{
          notFound
            ? '주소가 바뀌었거나 등록되지 않은 탈것입니다. 관제 센터에서 등록된 탈것을 다시 골라 주세요.'
            : '잠시 뒤 다시 시도해 주세요. 계속되면 관제 센터에서 처음부터 다시 열어 주세요.'
        }}
      </p>
      <a href="/fleet" class="not-found__link">관제 센터로 돌아가기</a>
    </div>
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
  transform: translateY(-200%);
}

.skip-link:focus {
  transform: none;
}

.not-found {
  position: relative;
  display: grid;
  min-height: calc(100svh - var(--header-height));
  align-items: end;
}

.not-found__body {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--space-4);
  max-width: 40rem;
  margin: 0 var(--gutter) var(--space-16);
  padding: var(--space-8);
  background: rgb(0 0 0 / 0.8);
}

.not-found__title {
  font-size: clamp(1.75rem, 5vw, 3rem);
}

.not-found__text {
  color: var(--color-text-muted);
}

.not-found__link {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  min-height: 3rem;
  padding: 0 var(--space-6);
  background: var(--color-crimson);
  color: #fff;
  text-decoration: none;
}
</style>
