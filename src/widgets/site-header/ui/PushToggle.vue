<script setup lang="ts">
import { computed } from 'vue'
import { HudButton } from '@shared/ui'
import { usePush } from '../model/use-push'

const props = defineProps<{ publicKey: string | null }>()
const { state, busy, message, enable, disable, test } = usePush(() => props.publicKey)

// 서버에 설정이 없거나 지원하지 않는 브라우저면 헤더에 아무것도 그리지 않습니다.
const visible = computed(() => state.value === 'on' || state.value === 'off' || state.value === 'denied')
const unavailable = computed(() => (state.value === 'denied' ? '알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용해 주세요.' : ''))
</script>

<template>
  <div v-if="visible" class="push">
    <HudButton
      v-if="state === 'on' || state === 'off'"
      size="sm"
      :pressed="state === 'on'"
      :disabled="busy"
      @click="state === 'on' ? disable() : enable()"
    >
      <span class="push__icon" aria-hidden="true">{{ state === 'on' ? '●' : '○' }}</span>
      위험 알림
    </HudButton>
    <HudButton v-if="state === 'on'" size="sm" :disabled="busy" @click="test">시험 알림</HudButton>
    <p class="push__message" role="status">{{ unavailable || message }}</p>
  </div>
</template>

<style scoped>
.push {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.push__icon {
  font-size: 0.625rem;
  color: var(--color-crimson-text);
}

.push__message {
  flex-basis: 100%;
  max-width: 22rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
</style>
