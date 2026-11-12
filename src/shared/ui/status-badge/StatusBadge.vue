<script setup lang="ts">
import { HEALTH_LABELS } from '../../api'
import type { HealthState } from '../../api'

/** 상태를 색과 글자로 함께 보여 줍니다(색만으로 구분하지 않음). */
const props = withDefaults(defineProps<{ state: HealthState; label?: string }>(), { label: undefined })
</script>

<template>
  <span :class="['status-badge', `status-badge--${props.state}`]">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ props.label ?? HEALTH_LABELS[props.state] }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  padding: 0.1rem 0.5rem;
  border: 1px solid currentColor;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.status-badge__dot {
  width: 0.5rem;
  height: 0.5rem;
  background: currentColor;
}

.status-badge--nominal {
  color: var(--color-nominal);
}

.status-badge--nominal .status-badge__dot {
  border-radius: 50%;
}

.status-badge--warning {
  color: var(--color-warning);
}

.status-badge--warning .status-badge__dot {
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.status-badge--critical {
  color: var(--color-critical);
}

.status-badge--critical .status-badge__dot {
  transform: rotate(45deg);
}
</style>
