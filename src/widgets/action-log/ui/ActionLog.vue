<script setup lang="ts">
import { computed, useId } from 'vue'
import { ACTIONS } from '@shared/api'
import type { ActionLogEntry } from '@shared/api'
import { formatClock, toIsoString } from '@shared/lib'
import { HudPanel } from '@shared/ui'

const props = withDefaults(defineProps<{ entries: ActionLogEntry[]; limit?: number; title?: string }>(), {
  limit: 8,
  title: '원격 조치 기록',
})
const PHASE_LABELS: Record<ActionLogEntry['phase'], string> = { sent: '전송', completed: '완료', failed: '실패' }

const id = useId()
const visible = computed(() => props.entries.slice(0, props.limit))
</script>

<template>
  <HudPanel class="action-log" :labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" class="action-log__title">{{ title }}</h2>
    <ol v-if="visible.length" class="action-log__list">
      <li v-for="entry in visible" :key="entry.id" :data-phase="entry.phase">
        <time :datetime="toIsoString(entry.at)" class="tabular hud-label">{{ formatClock(entry.at) }}</time>
        <span class="action-log__phase">{{ PHASE_LABELS[entry.phase] }}</span>
        <span class="action-log__message">{{ entry.message }}</span>
        <span class="visually-hidden">({{ ACTIONS[entry.action].label }})</span>
      </li>
    </ol>
    <p v-else class="action-log__empty">아직 보낸 원격 조치가 없습니다.</p>
  </HudPanel>
</template>

<style scoped>
.action-log {
  display: grid;
  gap: var(--space-4);
  align-content: start;
}

.action-log__title {
  font-size: 1.25rem;
}

.action-log__list {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.action-log__list li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: baseline;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-line);
  font-size: 0.875rem;
}

.action-log__phase {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-warning);
}

[data-phase='completed'] .action-log__phase {
  color: var(--color-nominal);
}

[data-phase='failed'] .action-log__phase {
  color: var(--color-critical);
}

.action-log__empty {
  color: var(--color-text-muted);
}
</style>
