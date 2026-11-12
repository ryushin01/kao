<script setup lang="ts">
import { computed, ref } from 'vue'
import { NuxtLink } from '#components'
import { useFetch, useHead } from '#imports'
import type { FleetFrame, RemoteActionResponse, VehicleKind } from '@shared/api'
import { formatClock, toIsoString } from '@shared/lib'
import { HudPanel } from '@shared/ui'
import { CATEGORY_LABELS, MODEL_PROFILES, VEHICLE_CATEGORIES, VehicleCard, activeIssues, fleetSummary, useLiveFleet } from '@entities/vehicle'
import { RemoteActionPanel } from '@features/remote-action'
import { ActionLog } from '@widgets/action-log'
import { FleetTracker } from '@widgets/fleet-tracker'
import { LiveAnnouncer } from '@widgets/live-announcer'

useHead({ title: '관제 센터 — KAO' })

const { data } = await useFetch<FleetFrame>('/api/fleet', { key: 'fleet' })
const { frame, status, applyAction } = useLiveFleet(data)

const summary = computed(() => (frame.value ? fleetSummary(frame.value) : null))

// 분류 필터: 아래의 조치 대기열·조치 기록·등록 탈것에 함께 적용합니다.
const kind = ref<VehicleKind | 'all'>('all')
const categories = computed(() =>
  VEHICLE_CATEGORIES.filter((category) => frame.value?.vehicles.some((vehicle) => vehicle.kind === category.kind)),
)
const shown = computed(() => (frame.value?.vehicles ?? []).filter((vehicle) => kind.value === 'all' || vehicle.kind === kind.value))
const shownLog = computed(() => {
  const ids = new Set(shown.value.map((vehicle) => vehicle.id))
  return (frame.value?.log ?? []).filter((entry) => ids.has(entry.vehicleId))
})
const scopeLabel = computed(() => (kind.value === 'all' ? '전체' : CATEGORY_LABELS[kind.value]))

const queue = computed(() =>
  shown.value
    .flatMap((vehicle) => activeIssues(vehicle).map((issue) => ({ vehicle, issue })))
    .sort((a, b) => (a.issue.severity === b.issue.severity ? a.issue.detectedAt - b.issue.detectedAt : a.issue.severity === 'critical' ? -1 : 1)),
)
const statusText = computed(
  () => ({ connecting: '연결 중', live: '실시간 수신 중', reconnecting: '다시 연결하는 중' })[status.value],
)

const onSent = (response: RemoteActionResponse) => applyAction(response)
</script>

<template>
  <div class="fleet">
    <header class="fleet__head">
      <p class="hud-label">Control Center</p>
      <h1 class="fleet__title">관제 센터</h1>
      <p class="fleet__lead">등록된 탈것 4대의 주행과 상태를 실시간으로 지켜보고, 문제가 생기면 여기서 바로 조치합니다.</p>
      <dl v-if="summary && frame" class="fleet__summary">
        <div>
          <dt>수신 상태</dt>
          <dd :data-status="status"><span class="fleet__pulse" aria-hidden="true" />{{ statusText }}</dd>
        </div>
        <div>
          <dt>마지막 수신</dt>
          <dd class="tabular">
            <time :datetime="toIsoString(frame.at)">{{ formatClock(frame.at) }}</time>
          </dd>
        </div>
        <div>
          <dt>조치 필요</dt>
          <dd class="tabular">{{ summary.open }}건</dd>
        </div>
        <div>
          <dt>위험 등급</dt>
          <dd class="tabular" :data-critical="summary.critical > 0">{{ summary.critical }}건</dd>
        </div>
        <div>
          <dt>조치 중</dt>
          <dd class="tabular">{{ summary.resolving }}건</dd>
        </div>
      </dl>
    </header>

    <template v-if="frame">
      <FleetTracker :frame="frame" />

      <fieldset class="fleet__filter">
        <legend>분류</legend>
        <label>
          <input v-model="kind" type="radio" name="fleet-kind" value="all" >
          <span>전체 <small class="tabular">{{ frame.vehicles.length }}</small></span>
        </label>
        <label v-for="category in categories" :key="category.kind">
          <input v-model="kind" type="radio" name="fleet-kind" :value="category.kind" >
          <span>
            {{ category.label }}
            <small class="tabular">{{ frame.vehicles.filter((vehicle) => vehicle.kind === category.kind).length }}</small>
          </span>
        </label>
      </fieldset>
      <p class="visually-hidden" role="status">{{ scopeLabel }} 분류의 탈것 {{ shown.length }}대를 보여 줍니다.</p>

      <div class="fleet__columns">
        <HudPanel class="fleet__queue" labelledby="queue-title">
          <h2 id="queue-title" class="fleet__section-title">조치 대기열</h2>
          <p class="fleet__note">위험 등급부터, 먼저 감지된 순서로 보여 줍니다.</p>
          <ul v-if="queue.length" class="fleet__issue-list">
            <li v-for="{ vehicle, issue } in queue" :key="issue.id">
              <p class="hud-label">
                <NuxtLink :to="`/fleet/${vehicle.id}`">{{ MODEL_PROFILES[vehicle.modelId].displayName }}</NuxtLink>
                · {{ vehicle.plate }}
              </p>
              <RemoteActionPanel
                :vehicle-id="vehicle.id"
                :vehicle-name="MODEL_PROFILES[vehicle.modelId].displayName"
                :issue="issue"
                @success="onSent"
              />
            </li>
          </ul>
          <p v-else class="fleet__empty">
            {{ kind === 'all' ? '지금은 조치할 문제가 없습니다. 모든 탈것이 기준 안에서 달리고 있습니다.' : `${scopeLabel} 분류에는 지금 조치할 문제가 없습니다.` }}
          </p>
        </HudPanel>
        <ActionLog :entries="shownLog" />
      </div>

      <section class="fleet__vehicles" aria-labelledby="vehicles-title">
        <h2 id="vehicles-title" class="fleet__section-title">등록 탈것</h2>
        <ul>
          <li v-for="vehicle in shown" :key="vehicle.id">
            <VehicleCard :vehicle="vehicle">
              <template #title>
                <NuxtLink :to="`/fleet/${vehicle.id}`" class="fleet__card-link">
                  {{ MODEL_PROFILES[vehicle.modelId].displayName }}
                </NuxtLink>
              </template>
            </VehicleCard>
          </li>
        </ul>
      </section>
    </template>
    <p v-else role="alert">관제 데이터를 불러오지 못했습니다. 잠시 뒤 새로 고쳐 주세요.</p>

    <LiveAnnouncer :frame="frame" />
  </div>
</template>

<style scoped>
.fleet {
  display: grid;
  gap: var(--space-8);
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--space-12) var(--gutter) var(--space-24);
}

.fleet__head {
  display: grid;
  gap: var(--space-3);
}

.fleet__title {
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  font-weight: 800;
  letter-spacing: -0.04em;
}

.fleet__lead {
  max-width: 40rem;
  color: var(--color-text-muted);
}

.fleet__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  margin: var(--space-4) 0 0;
  border-top: 1px solid var(--color-line);
  border-left: 1px solid var(--color-line);
}

.fleet__summary div {
  padding: var(--space-4);
  border-right: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
}

.fleet__summary dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.fleet__summary dd {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-1) 0 0;
  font-family: var(--font-mono);
  font-size: 1.25rem;
}

.fleet__summary dd[data-critical='true'] {
  color: var(--color-critical);
}

.fleet__pulse {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-text-muted);
}

[data-status='live'] .fleet__pulse {
  background: var(--color-nominal);
  animation: pulse 1.6s ease-in-out infinite;
}

[data-status='reconnecting'] .fleet__pulse {
  background: var(--color-warning);
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.fleet__filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.fleet__filter legend {
  float: left;
  width: 100%;
  margin-bottom: var(--space-2);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.fleet__filter label {
  position: relative;
}

.fleet__filter input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.fleet__filter span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.75rem;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-line-strong);
  font-size: 0.875rem;
}

.fleet__filter small {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.fleet__filter input:checked + span {
  border-color: var(--color-crimson);
  background: var(--color-crimson);
  color: #fff;
}

.fleet__filter input:checked + span small {
  color: #fff;
}

.fleet__filter input:focus-visible + span {
  outline: 2px solid var(--color-crimson-text);
  outline-offset: 3px;
}

.fleet__columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

@media (width < 64rem) {
  .fleet__filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.fleet__filter legend {
  float: left;
  width: 100%;
  margin-bottom: var(--space-2);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.fleet__filter label {
  position: relative;
}

.fleet__filter input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.fleet__filter span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.75rem;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-line-strong);
  font-size: 0.875rem;
}

.fleet__filter small {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.fleet__filter input:checked + span {
  border-color: var(--color-crimson);
  background: var(--color-crimson);
  color: #fff;
}

.fleet__filter input:checked + span small {
  color: #fff;
}

.fleet__filter input:focus-visible + span {
  outline: 2px solid var(--color-crimson-text);
  outline-offset: 3px;
}

.fleet__columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.fleet__queue {
  display: grid;
  gap: var(--space-4);
}

.fleet__section-title {
  font-size: 1.5rem;
}

.fleet__note,
.fleet__empty {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.fleet__issue-list {
  display: grid;
  gap: var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
}

.fleet__issue-list li {
  display: grid;
  gap: var(--space-2);
}

.fleet__issue-list a {
  color: var(--color-text);
}

.fleet__vehicles {
  display: grid;
  gap: var(--space-4);
}

.fleet__vehicles ul {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.fleet__card-link {
  text-decoration: none;
}

.fleet__card-link::after {
  content: '';
  position: absolute;
  inset: 0;
}

.fleet__card-link:hover {
  text-decoration: underline;
}
</style>
