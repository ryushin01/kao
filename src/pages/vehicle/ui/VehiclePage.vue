<script setup lang="ts">
import { computed } from 'vue'
import { NuxtLink } from '#components'
import { createError, useFetch, useHead, useRoute } from '#imports'
import { FLEET_URL } from '@shared/api'
import type { FleetFrame, RemoteActionResponse } from '@shared/api'
import { findRoute } from '@shared/config'
import { formatNumber, formatPercent } from '@shared/lib'
import { HudPanel, StatusBadge } from '@shared/ui'
import { useSession } from '@entities/session'
import { CATEGORY_LABELS, MODEL_PROFILES, MetricReadout, useLiveFleet } from '@entities/vehicle'
import { RemoteActionPanel } from '@features/remote-action'
import { ActionLog } from '@widgets/action-log'
import { FleetTracker } from '@widgets/fleet-tracker'
import { LiveAnnouncer } from '@widgets/live-announcer'
import { VehicleShowcase } from '@widgets/vehicle-showcase'
import MetricHistory from './MetricHistory.vue'

const route = useRoute()
const { user } = useSession()
const isOperator = computed(() => user.value?.role === 'operator')
const vehicleId = computed(() => String(route.params.id))

const { data } = await useFetch<FleetFrame>(FLEET_URL, { key: 'fleet' })
if (!data.value?.vehicles.some((vehicle) => vehicle.id === vehicleId.value)) {
  throw createError({ statusCode: 404, statusMessage: '등록되지 않은 탈것입니다.', fatal: true })
}
const { frame, applyAction } = useLiveFleet(data)

const vehicle = computed(() => frame.value!.vehicles.find((item) => item.id === vehicleId.value)!)
const profile = computed(() => MODEL_PROFILES[vehicle.value.modelId])
const title = computed(() => profile.value.displayName)
const issues = computed(() =>
  [...vehicle.value.issues].sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.detectedAt - a.detectedAt),
)
const log = computed(() => frame.value!.log.filter((entry) => entry.vehicleId === vehicleId.value))

useHead({ title: () => `${title.value} — KAO 관제` })

const onSent = (response: RemoteActionResponse) => applyAction(response)
</script>

<template>
  <div class="vehicle">
    <nav class="vehicle__crumbs" aria-label="이동 경로">
      <ol>
        <li v-if="isOperator"><NuxtLink to="/fleet">관제 센터</NuxtLink></li>
        <li v-else><NuxtLink to="/">소개</NuxtLink></li>
        <li><a :href="`/fleet/${vehicle.id}`" aria-current="page">{{ title }}</a></li>
      </ol>
    </nav>

    <header class="vehicle__head">
      <p class="hud-label">{{ vehicle.plate }} · {{ CATEGORY_LABELS[vehicle.kind] }} · {{ vehicle.member }}</p>
      <h1 class="vehicle__title">{{ title }}</h1>
      <p class="vehicle__model">{{ vehicle.model }} · {{ vehicle.year }} · {{ vehicle.paint.name }}</p>
      <div class="vehicle__state">
        <StatusBadge :state="vehicle.health" />
        <span class="vehicle__source" :data-source="vehicle.source">{{ vehicle.source === 'live' ? '실차 신호' : '시뮬레이션' }}</span>
        <span class="tabular">{{ formatNumber(vehicle.speed) }} km/h</span>
        <span v-if="vehicle.gps && !vehicle.gps.onRoute">
          {{ findRoute(vehicle.routeId).name }}에서 벗어남 · GPS {{ formatNumber(vehicle.gps.lat, 5) }}, {{ formatNumber(vehicle.gps.lng, 5) }}
        </span>
        <span v-else>
          {{ findRoute(vehicle.routeId).name }} · 정각부터 {{ vehicle.lap }}바퀴째 · {{ formatPercent(vehicle.progress) }}<template v-if="vehicle.positionSource === 'gps'"> · GPS 기준</template>
        </span>
        <span v-if="vehicle.speedCap" class="vehicle__cap">속도 제한 {{ vehicle.speedCap }} km/h 적용 중</span>
      </div>
    </header>

    <div class="vehicle__top">
      <HudPanel labelledby="miniature-title" class="vehicle__miniature">
        <h2 id="miniature-title" class="vehicle__section-title">미니어처</h2>
        <VehicleShowcase :vehicle="vehicle" />
        <dl class="vehicle__spec">
          <div v-for="spec in profile.specs" :key="spec.label">
            <dt>{{ spec.label }}</dt>
            <dd>{{ spec.value }}</dd>
          </div>
        </dl>
      </HudPanel>

      <HudPanel labelledby="issues-title" class="vehicle__issues">
        <h2 id="issues-title" class="vehicle__section-title">문제와 원격 조치</h2>
        <ul v-if="issues.length">
          <li v-for="issue in issues" :key="issue.id">
            <RemoteActionPanel
              :vehicle-id="vehicle.id"
              :vehicle-name="title"
              :issue="issue"
              :readonly="!isOperator"
              @success="onSent"
            />
          </li>
        </ul>
        <p v-else class="vehicle__empty">감지된 문제가 없습니다. 모든 지표가 기준 안에 있습니다.</p>
      </HudPanel>
    </div>

    <section class="vehicle__telemetry" aria-labelledby="telemetry-title">
      <h2 id="telemetry-title" class="vehicle__section-title">실시간 지표</h2>
      <ul>
        <li v-for="metric in vehicle.metrics" :key="metric.key">
          <MetricReadout :metric="metric" />
        </li>
      </ul>
    </section>

    <MetricHistory :vehicle-id="vehicle.id" :metrics="vehicle.metrics" />

    <div class="vehicle__bottom">
      <FleetTracker :frame="frame!" :initial-follow="vehicle.id" title="경로 위치" />
      <ActionLog :entries="log" title="이 탈것의 조치 기록" />
    </div>

    <LiveAnnouncer :frame="frame" />
  </div>
</template>

<style scoped>
.vehicle {
  display: grid;
  gap: var(--space-8);
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--space-8) var(--gutter) var(--space-24);
}

.vehicle__crumbs ol {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
}

.vehicle__crumbs li + li::before {
  content: '/';
  margin-right: var(--space-2);
  color: var(--color-text-muted);
}

.vehicle__crumbs a {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  color: var(--color-text-muted);
}

.vehicle__crumbs a[aria-current='page'] {
  color: var(--color-text);
  text-decoration: none;
}

.vehicle__head {
  display: grid;
  gap: var(--space-3);
}

.vehicle__title {
  font-size: clamp(2.5rem, 7vw, 5rem);
  font-weight: 800;
  letter-spacing: -0.04em;
}

.vehicle__model {
  color: var(--color-text-muted);
}

.vehicle__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.vehicle__source {
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--color-line-strong);
  font-size: 0.75rem;
}

.vehicle__source[data-source='live'] {
  border-color: var(--color-nominal);
  color: var(--color-nominal);
}

.vehicle__cap {
  color: var(--color-warning);
}

.vehicle__top,
.vehicle__bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

@media (width < 64rem) {
  .vehicle__top,
  .vehicle__bottom {
    grid-template-columns: minmax(0, 1fr);
  }
}

.vehicle__miniature,
.vehicle__issues {
  display: grid;
  gap: var(--space-4);
}

.vehicle__section-title {
  font-size: 1.5rem;
}

.vehicle__spec {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.vehicle__spec dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.vehicle__spec dd {
  margin: 0;
  font-family: var(--font-mono);
}

.vehicle__issues ul,
.vehicle__telemetry ul {
  display: grid;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.vehicle__telemetry {
  display: grid;
  gap: var(--space-4);
}

.vehicle__telemetry ul {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
}

.vehicle__empty {
  color: var(--color-text-muted);
}
</style>
