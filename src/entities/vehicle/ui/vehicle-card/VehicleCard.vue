<script setup lang="ts">
import { computed } from 'vue'
import type { VehicleSnapshot } from '@shared/api'
import { findRoute } from '@shared/config'
import { formatNumber, formatPercent } from '@shared/lib'
import { StatusBadge } from '@shared/ui'
import { CATEGORY_LABELS } from '../../config/categories'
import { MODEL_PROFILES } from '../../config/models'
import { activeIssues } from '../../model/selectors'

const props = defineProps<{ vehicle: VehicleSnapshot }>()

const profile = computed(() => MODEL_PROFILES[props.vehicle.modelId])
const route = computed(() => findRoute(props.vehicle.routeId))
const issues = computed(() => activeIssues(props.vehicle))
</script>

<template>
  <article class="vehicle-card" :data-health="vehicle.health">
    <header class="vehicle-card__head">
      <p class="hud-label">{{ vehicle.plate }} · {{ CATEGORY_LABELS[vehicle.kind] }}</p>
      <h3 class="vehicle-card__title">
        <slot name="title">{{ profile.displayName }}</slot>
      </h3>
      <StatusBadge :state="vehicle.health" />
    </header>
    <dl class="vehicle-card__stats">
      <div>
        <dt>속도</dt>
        <dd class="tabular">
          {{ formatNumber(vehicle.speed) }}<span class="vehicle-card__unit">km/h</span>
        </dd>
      </div>
      <div>
        <dt>{{ route.name }}</dt>
        <dd class="tabular">{{ vehicle.lap }}바퀴 · {{ formatPercent(vehicle.progress) }}</dd>
      </div>
      <div>
        <dt>열린 문제</dt>
        <dd class="tabular">{{ issues.length }}건</dd>
      </div>
    </dl>
    <p class="vehicle-card__member">{{ vehicle.member }} · {{ vehicle.paint.name }}</p>
  </article>
</template>

<style scoped>
.vehicle-card {
  position: relative;
  display: grid;
  gap: var(--space-4);
  height: 100%;
  padding: var(--space-6);
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  transition: border-color 0.2s var(--ease-out);
}

.vehicle-card:hover,
.vehicle-card:focus-within {
  border-color: var(--color-crimson-text);
}

.vehicle-card[data-health='critical'] {
  box-shadow: inset 3px 0 0 var(--color-critical);
}

.vehicle-card[data-health='warning'] {
  box-shadow: inset 3px 0 0 var(--color-warning);
}

.vehicle-card__head {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}

.vehicle-card__title {
  font-size: 1.375rem;
}

.vehicle-card__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.vehicle-card__stats dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.vehicle-card__stats dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.9375rem;
}

.vehicle-card__unit {
  margin-left: 0.2em;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.vehicle-card__member {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
</style>
