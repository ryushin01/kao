<script setup lang="ts">
import { computed } from 'vue'
import type { MetricReading } from '@shared/api'
import { formatNumber } from '@shared/lib'
import { StatusBadge } from '@shared/ui'

const props = defineProps<{ metric: MetricReading }>()

const ratio = (value: number) => (value - props.metric.min) / (props.metric.max - props.metric.min)
const fill = computed(() => `${Math.min(100, Math.max(0, ratio(props.metric.value) * 100))}%`)
const watched = computed(() => props.metric.warn !== null)
const limits = computed(() => {
  const { warn, crit, direction, precision, unit } = props.metric
  if (warn === null || crit === null) return ''
  const word = direction === 'high' ? '이상' : '이하'
  return `경고 ${formatNumber(warn, precision)}${unit} ${word} · 위험 ${formatNumber(crit, precision)}${unit} ${word}`
})
</script>

<template>
  <div class="metric" :data-state="metric.state">
    <div class="metric__head">
      <span class="metric__label">{{ metric.label }}</span>
      <StatusBadge v-if="watched" :state="metric.state" />
    </div>
    <p class="metric__value">
      <span class="tabular">{{ formatNumber(metric.value, metric.precision) }}</span>
      <span class="metric__unit">{{ metric.unit }}</span>
    </p>
    <div class="metric__bar" aria-hidden="true">
      <span class="metric__fill" :style="{ width: fill }" />
      <span v-if="metric.warn !== null" class="metric__tick" :style="{ left: `${ratio(metric.warn) * 100}%` }" />
      <span
        v-if="metric.crit !== null"
        class="metric__tick metric__tick--crit"
        :style="{ left: `${ratio(metric.crit) * 100}%` }"
      />
    </div>
    <p v-if="limits" class="metric__limits">{{ limits }}</p>
  </div>
</template>

<style scoped>
.metric {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-line);
  background: var(--color-surface-raised);
}

.metric[data-state='warning'] {
  border-color: rgb(245 181 68 / 0.6);
}

.metric[data-state='critical'] {
  border-color: var(--color-critical);
  background: linear-gradient(180deg, rgb(139 0 0 / 0.35), var(--color-surface-raised));
}

.metric__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.metric__label {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.metric__value {
  font-family: var(--font-mono);
  font-size: 1.75rem;
  line-height: 1.1;
}

.metric__unit {
  margin-left: 0.25em;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.metric__bar {
  position: relative;
  height: 4px;
  background: var(--color-line);
}

.metric__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--color-text);
  transition: width 0.4s var(--ease-out);
}

[data-state='warning'] .metric__fill {
  background: var(--color-warning);
}

[data-state='critical'] .metric__fill {
  background: var(--color-critical);
}

.metric__tick {
  position: absolute;
  top: -4px;
  width: 1px;
  height: 12px;
  background: var(--color-warning);
}

.metric__tick--crit {
  background: var(--color-critical);
}

.metric__limits {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
</style>
