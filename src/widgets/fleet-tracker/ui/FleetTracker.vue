<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import type { FleetFrame } from '@shared/api'
import { HEALTH_LABELS } from '@shared/api'
import { findRoute } from '@shared/config'
import { formatNumber, formatPercent, isWebGLAvailable, useMotion, whenNearViewport } from '@shared/lib'
import { HudPanel, StatusBadge } from '@shared/ui'
import { MODEL_PROFILES } from '@entities/vehicle'
import { MAP_PLACES } from '../config/places'
import type { TrackerScene } from '../lib/tracker-scene'

const props = withDefaults(defineProps<{ frame: FleetFrame; initialFollow?: string; title?: string }>(), {
  initialFollow: 'all',
  title: '미니어처 관제 지도',
})

const id = useId()
const canvas = ref<HTMLCanvasElement | null>(null)
const labels = ref<Record<string, HTMLElement | null>>({})
const supported = ref(true)
const follow = ref<string>(props.initialFollow)
const scene = shallowRef<TrackerScene | null>(null)
const { paused } = useMotion()

const vehicles = computed(() => props.frame.vehicles)
const gpsCount = computed(() => vehicles.value.filter((vehicle) => vehicle.positionSource === 'gps').length)
const description = computed(
  () =>
    `서울 도심 관제 지도. 광화문·남산·한강·여의도의 실제 도로 위를 ${vehicles.value.length}대의 미니어처가 각자의 경로로 달리고 있습니다. ` +
    (gpsCount.value > 0 ? `실차 GPS로 위치를 받는 ${gpsCount.value}대는 실제 위치에, 나머지는 ` : '') +
    `움직임이 보이도록 실제보다 ${props.frame.timeScale}배 빠르게 움직이며, 실제 위치와 상태는 지도 아래 표에 있습니다.`,
)
const positionLabel = (vehicle: FleetFrame['vehicles'][number]) => {
  if (vehicle.positionSource === 'gps') return 'GPS'
  return vehicle.gps ? 'GPS 경로 밖(시뮬레이션 위치)' : '시뮬레이션'
}

const setLabel = (vehicleId: string) => (el: unknown) => {
  labels.value[vehicleId] = el as HTMLElement | null
}

let unmounted = false
let stopWatching = () => {}

// three.js 장면은 브라우저에서, 지도가 화면 가까이 왔을 때 만듭니다(탈것 상세처럼 아래쪽에 있을 때 첫 로딩을 가볍게).
async function start() {
  const { createTrackerScene } = await import('../lib/tracker-scene')
  if (unmounted || !canvas.value) return
  scene.value = createTrackerScene({
    canvas: canvas.value,
    frame: props.frame,
    playing: !paused.value,
    onProject(vehicleId, x, y, visible) {
      const label = labels.value[vehicleId]
      if (!label) return
      // 탈것 이름표는 미니어처 위에, 지명은 그 자리 한가운데에 둡니다.
      const anchor = vehicleId.startsWith('place:') ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)'
      label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${anchor}`
      label.style.opacity = visible ? '1' : '0'
    },
    onPick(vehicleId) {
      follow.value = vehicleId
    },
  })
  if (follow.value !== 'all') scene.value.setFollow(follow.value)
}

onMounted(() => {
  if (!canvas.value || !isWebGLAvailable()) {
    supported.value = false
    return
  }
  stopWatching = whenNearViewport(canvas.value, () => void start())
})

watch(
  () => props.frame,
  (frame) => scene.value?.setFrame(frame),
)
watch(follow, (value) => scene.value?.setFollow(value === 'all' ? null : value))
watch(paused, (value) => scene.value?.setPlaying(!value))

onBeforeUnmount(() => {
  unmounted = true
  stopWatching()
  scene.value?.dispose()
  scene.value = null
})
</script>

<template>
  <HudPanel class="tracker" :labelledby="`${id}-title`">
    <div class="tracker__head">
      <div>
        <p class="hud-label">Live Tracking · 지도 {{ frame.timeScale }}배속</p>
        <h2 :id="`${id}-title`" class="tracker__title">{{ title }}</h2>
      </div>
      <fieldset class="tracker__follow">
        <legend class="hud-label">카메라 시점</legend>
        <label>
          <input v-model="follow" type="radio" :name="`${id}-follow`" value="all" >
          <span>전체</span>
        </label>
        <label v-for="vehicle in vehicles" :key="vehicle.id">
          <input v-model="follow" type="radio" :name="`${id}-follow`" :value="vehicle.id" >
          <span>{{ MODEL_PROFILES[vehicle.modelId].shortName }}</span>
        </label>
      </fieldset>
    </div>

    <div class="tracker__stage">
      <canvas v-if="supported" ref="canvas" class="tracker__canvas" role="img" :aria-label="description" />
      <p v-else class="tracker__fallback">
        이 브라우저에서는 3D 지도를 그릴 수 없습니다(WebGL 미지원). 아래 표에서 위치를 확인해 주세요.
      </p>
      <div v-if="supported" class="tracker__labels" aria-hidden="true">
        <span v-for="place in MAP_PLACES" :key="place.id" :ref="setLabel(`place:${place.id}`)" class="tracker__place">{{ place.name }}</span>
        <div
          v-for="vehicle in vehicles"
          :key="vehicle.id"
          :ref="setLabel(vehicle.id)"
          class="tracker__label"
          :data-health="vehicle.health"
          :data-active="follow === vehicle.id"
        >
          <strong>{{ MODEL_PROFILES[vehicle.modelId].shortName }}</strong>
          <span class="tabular">{{ formatNumber(vehicle.speed) }} km/h</span>
          <span v-if="vehicle.health !== 'nominal'">{{ HEALTH_LABELS[vehicle.health] }}</span>
        </div>
      </div>
      <div class="tracker__footer">
        <!-- 지도 데이터 출처는 OpenStreetMap 재단 지침대로 지도 위에 둡니다(다른 자료의 출처는 README). -->
        <p v-if="supported" class="tracker__attribution">
          지도 데이터 <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap 기여자</a>
        </p>
        <p class="tracker__hint hud-label" aria-hidden="true">끌어서 회전 · 휠로 확대 · 탈것을 누르면 따라가기</p>
      </div>
    </div>

    <div class="tracker__table-wrap" role="region" :aria-labelledby="`${id}-caption`" tabindex="0">
      <table class="tracker__table">
        <caption :id="`${id}-caption`" class="hud-label">주행 위치 표(실제 속도·GPS 기준)</caption>
        <thead>
          <tr>
            <th scope="col">탈것</th>
            <th scope="col">경로</th>
            <th scope="col">위치 기준</th>
            <th scope="col">바퀴(정각부터)</th>
            <th scope="col">진행</th>
            <th scope="col">속도</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicle in vehicles" :key="vehicle.id">
            <th scope="row">{{ MODEL_PROFILES[vehicle.modelId].displayName }}</th>
            <td>{{ findRoute(vehicle.routeId).name }}</td>
            <td>{{ positionLabel(vehicle) }}</td>
            <td class="tabular">{{ vehicle.lap }}</td>
            <td class="tabular">{{ formatPercent(vehicle.progress) }}</td>
            <td class="tabular">
              {{ formatNumber(vehicle.speed) }} km/h
              <span v-if="vehicle.speedCap" class="tracker__cap">(제한 {{ vehicle.speedCap }})</span>
            </td>
            <td><StatusBadge :state="vehicle.health" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </HudPanel>
</template>

<style scoped>
.tracker {
  display: grid;
  gap: var(--space-6);
}

.tracker__head {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-4);
}

.tracker__title {
  font-size: clamp(1.5rem, 3vw, 2rem);
}

.tracker__follow {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.tracker__follow legend {
  float: left;
  width: 100%;
  margin-bottom: var(--space-2);
}

.tracker__follow label {
  position: relative;
  cursor: pointer;
}

.tracker__follow input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.tracker__follow span {
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-line-strong);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
}

.tracker__follow input:checked + span {
  border-color: var(--color-crimson-text);
  background: var(--color-crimson);
  color: #fff;
}

.tracker__follow input:focus-visible + span {
  outline: 2px solid var(--color-crimson-text);
  outline-offset: 3px;
}

.tracker__stage {
  position: relative;
  height: clamp(22rem, 62vh, 40rem);
  overflow: hidden;
  border: 1px solid var(--color-line);
  background: radial-gradient(ellipse at 50% 40%, #1a0505, #000 70%);
}

.tracker__canvas {
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}

.tracker__canvas:active {
  cursor: grabbing;
}

.tracker__fallback {
  padding: var(--space-8);
  color: var(--color-text-muted);
}

.tracker__labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tracker__label {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  padding: 0.25rem 0.5rem;
  border-left: 2px solid var(--color-text);
  background: rgb(0 0 0 / 0.72);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.35;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
  will-change: transform;
}

.tracker__place {
  position: absolute;
  top: 0;
  left: 0;
  padding: 0 var(--space-1);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  text-shadow: 0 0 4px #000, 0 0 2px #000;
  white-space: nowrap;
  opacity: 0;
}

.tracker__label strong {
  font-size: 0.75rem;
}

.tracker__label[data-health='warning'] {
  border-color: var(--color-warning);
}

.tracker__label[data-health='critical'] {
  border-color: var(--color-critical);
  color: #fff;
}

.tracker__label[data-active='true'] {
  background: var(--color-crimson);
}

/* 지도 아래쪽 한 줄: 왼쪽에 지도 데이터 출처, 오른쪽에 조작 안내. 좁으면 안내가 위 줄로 접힙니다. */
.tracker__footer {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-2);
  left: var(--space-3);
  display: flex;
  flex-wrap: wrap-reverse;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
  pointer-events: none;
}

.tracker__attribution {
  margin: 0;
  padding: 0 var(--space-2);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  background: rgb(0 0 0 / 0.65);
  pointer-events: auto;
}

.tracker__attribution a {
  /* 누르기 쉬운 높이(바닥글 출처 링크와 같게) */
  display: inline-block;
  padding-block: 0.375rem;
  color: var(--color-text);
  text-underline-offset: 0.2em;
}

.tracker__hint {
  margin: 0 0 0 auto;
  padding-bottom: var(--space-1);
  font-size: 0.6875rem;
}

.tracker__table-wrap {
  overflow-x: auto;
}

.tracker__table {
  width: 100%;
  min-width: 36rem;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.tracker__table caption {
  margin-bottom: var(--space-2);
  text-align: left;
}

.tracker__table th,
.tracker__table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-line);
  text-align: left;
}

.tracker__table thead th {
  font-weight: 500;
  color: var(--color-text-muted);
}

.tracker__cap {
  color: var(--color-warning);
}
</style>
