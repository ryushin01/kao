<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { fetchHistory } from '@shared/api'
import type { HistoryResponse, MetricReading } from '@shared/api'
import { formatNumber } from '@shared/lib'
import { HudPanel, LineChart } from '@shared/ui'
import type { ChartThreshold } from '@shared/ui'

const props = defineProps<{ vehicleId: string; metrics: MetricReading[] }>()

const id = useId()
const RANGES = [10, 30, 60] as const
const watched = computed(() => props.metrics.filter((metric) => metric.warn !== null))
const metricKey = ref(watched.value[0]?.key ?? props.metrics[0]?.key ?? 'speed')
const minutes = ref<(typeof RANGES)[number]>(10)
const history = shallowRef<HistoryResponse | null>(null)
const loading = ref(false)
const error = ref('')
let timer: ReturnType<typeof setInterval> | undefined

const metric = computed(() => props.metrics.find((item) => item.key === metricKey.value))
const thresholds = computed<ChartThreshold[]>(() => {
  const current = metric.value
  if (!current) return []
  const list: ChartThreshold[] = []
  if (current.warn !== null) list.push({ value: current.warn, label: `경고 ${formatNumber(current.warn, current.precision)}`, tone: 'warning' })
  if (current.crit !== null) list.push({ value: current.crit, label: `위험 ${formatNumber(current.crit, current.precision)}`, tone: 'critical' })
  return list
})

/** 실차 측정값으로 채운 점이 있으면 몇 점인지 알립니다(나머지는 시뮬레이션). */
const sourceNote = computed(() => {
  const current = history.value
  if (!current || current.liveSamples === 0) return ''
  if (current.liveSamples === current.samples.length) return '그래프의 모든 점이 실차 측정값입니다.'
  return `그래프 ${current.samples.length}점 가운데 ${current.liveSamples}점이 실차 측정값이고, 나머지는 시뮬레이션입니다.`
})

let latest = 0

async function load() {
  // 고른 지표·기간이 바뀌면 먼저 보낸 요청의 응답은 버립니다.
  const request = ++latest
  const key = `${metricKey.value}:${minutes.value}`
  loading.value = true
  try {
    const result = await fetchHistory(props.vehicleId, metricKey.value, minutes.value)
    if (request !== latest) return
    history.value = result
    error.value = ''
  } catch (cause) {
    if (request !== latest) return
    // 다른 지표의 그림이 남아 오해하지 않도록, 고른 것이 바뀐 뒤 실패하면 그림을 지웁니다.
    if (history.value && `${history.value.metric.key}:${(history.value.to - history.value.from) / 60_000}` !== key) history.value = null
    error.value = cause instanceof Error ? cause.message : '기록을 불러오지 못했습니다.'
  } finally {
    if (request === latest) loading.value = false
  }
}

onMounted(() => {
  void load()
  // 10초마다 새로 그립니다. 다시 받는 동안에는 이전 그림을 흐리게 둡니다.
  timer = setInterval(load, 10_000)
})
onBeforeUnmount(() => clearInterval(timer))
watch([metricKey, minutes], load)
</script>

<template>
  <HudPanel class="history" :labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" class="history__title">지표 이력</h2>
    <div class="history__filters">
      <div class="history__field">
        <label :for="`${id}-metric`">지표</label>
        <div class="history__select">
          <select :id="`${id}-metric`" v-model="metricKey">
            <option v-for="item in metrics" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </div>
      </div>
      <fieldset class="history__range">
        <legend>기간</legend>
        <label v-for="range in RANGES" :key="range">
          <input v-model="minutes" type="radio" :name="`${id}-range`" :value="range" >
          <span>최근 {{ range }}분</span>
        </label>
      </fieldset>
    </div>
    <p v-if="sourceNote" class="history__note">{{ sourceNote }}</p>
    <p v-if="error" role="alert" class="history__error">{{ error }}</p>
    <LineChart
      v-if="metric && history"
      :samples="history.samples"
      :label="`${metric.label} 이력`"
      :unit="metric.unit"
      :precision="metric.precision"
      :thresholds="thresholds"
      :loading="loading"
    />
    <p v-else-if="!error" class="history__note">기록을 불러오는 중입니다.</p>
  </HudPanel>
</template>

<style scoped>
.history {
  display: grid;
  gap: var(--space-4);
}

.history__title {
  font-size: 1.5rem;
}

.history__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--space-4);
}

.history__field {
  display: grid;
  gap: var(--space-1);
  font-size: 0.875rem;
}

/* 셀렉트 좌우 간격: 화살표와 칸 오른쪽 끝 사이를 글자와 칸 왼쪽 끝 사이(테두리 1px + 안쪽 여백)와 같게 둡니다. */
.history__select {
  position: relative;
}

.history__select select {
  appearance: none;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 calc(var(--space-3) + 1rem + var(--space-2)) 0 var(--space-3);
  border: 1px solid var(--color-line-strong);
  border-radius: 0;
  background: var(--color-surface-raised);
}

.history__select svg {
  position: absolute;
  top: 50%;
  right: calc(var(--space-3) + 1px);
  width: 1rem;
  height: 1rem;
  translate: 0 -50%;
  pointer-events: none;
}

.history__range {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.history__range legend {
  float: left;
  width: 100%;
  margin-bottom: var(--space-1);
  font-size: 0.875rem;
}

.history__range label {
  position: relative;
}

.history__range input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.history__range span {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-line-strong);
  font-size: 0.8125rem;
}

.history__range input:checked + span {
  border-color: var(--color-crimson);
  background: var(--color-crimson);
  color: #fff;
}

.history__range input:focus-visible + span {
  outline: 2px solid var(--color-crimson-text);
  outline-offset: 3px;
}

.history__error {
  color: var(--color-critical);
}

.history__note {
  color: var(--color-text-muted);
}
</style>
