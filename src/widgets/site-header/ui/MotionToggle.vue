<script setup lang="ts">
import { useMotion } from '@shared/lib'
import { HudButton } from '@shared/ui'

const { paused, toggle } = useMotion()
</script>

<template>
  <HudButton size="sm" :pressed="paused" @click="toggle">
    <span class="motion-toggle__icon" aria-hidden="true">{{ paused ? '▶' : '❚❚' }}</span>
    애니메이션 정지
  </HudButton>
</template>

<style scoped>
.motion-toggle__icon {
  font-size: 0.625rem;
}
</style>
