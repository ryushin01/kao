<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { formatClock, formatNumber, toIsoString } from '../../lib'

export interface ChartThreshold {
  value: number
  label: string
  tone: 'warning' | 'critical'
}

/**
 * 계열 하나짜리 시계열 선 그래프.
 * - 2px 선, 끝점 표식과 마지막 값 직접 라벨, 1px 실선 격자(배경에 묻히게)
 * - 기준선은 상태 색 선 + 글자 라벨(색만으로 구분하지 않음)
 * - 십자선과 툴팁: 포인터와 키보드(←·→·Home·End) 모두. 같은 값은 표로도 볼 수 있습니다.
 */
const props = withDefaults(
  defineProps<{
    samples: Array<{ at: number; value: number }>
    label: string
    unit: string
    precision?: number
    thresholds?: ChartThreshold[]
    loading?: boolean
  }>(),
  { precision: 0, thresholds: () => [], loading: false },
)

const id = useId()
const box = ref<HTMLElement | null>(null)
const width = ref(640)
const height = 240
const pad = { top: 16, right: 92, bottom: 28, left: 52 }
const active = ref<number | null>(null)
const keyboardText = ref('')
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!box.value) return
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = Math.max(280, entry.contentRect.width)
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

const domain = computed(() => {
  const values = props.samples.map((sample) => sample.value)
  const nearby = props.thresholds.map((item) => item.value)
  const all = values.length ? [...values, ...nearby] : [0, 1]
  let min = Math.min(...all)
  let max = Math.max(...all)
  if (min === max) {
    min -= 1
    max += 1
  }
  const room = (max - min) * 0.12
  return { min: min - room, max: max + room }
})

const x = (index: number) => pad.left + (index / Math.max(1, props.samples.length - 1)) * (width.value - pad.left - pad.right)
const y = (value: number) => pad.top + (1 - (value - domain.value.min) / (domain.value.max - domain.value.min)) * (height - pad.top - pad.bottom)

const path = computed(() => props.samples.map((sample, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(sample.value).toFixed(1)}`).join(''))

const yTicks = computed(() => {
  const { min, max } = domain.value
  return Array.from({ length: 4 }, (_, i) => min + ((max - min) * (i + 0.5)) / 4)
})

const xTicks = computed(() => {
  const count = width.value < 480 ? 3 : 5
  const last = props.samples.length - 1
  if (last < 1) return []
  return Array.from({ length: count }, (_, i) => Math.round((last * i) / (count - 1)))
})

const lastIndex = computed(() => props.samples.length - 1)
const last = computed(() => props.samples[lastIndex.value])
const pointed = computed(() => (active.value === null ? null : props.samples[active.value] ?? null))
const format = (value: number) => `${formatNumber(value, props.precision)}${props.unit}`

const summary = computed(() => {
  if (!props.samples.length) return `${props.label} 기록이 아직 없습니다.`
  const values = props.samples.map((sample) => sample.value)
  const limits = props.thresholds.length ? ` 기준선: ${props.thresholds.map((item) => `${item.label}${props.unit}`).join(', ')}.` : ''
  return `${props.label} 그래프. ${formatClock(props.samples[0]!.at)}부터 ${formatClock(last.value!.at)}까지, 최저 ${format(Math.min(...values))}, 최고 ${format(Math.max(...values))}, 마지막 ${format(last.value!.value)}.${limits}`
})

function pick(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  const ratio = (event.clientX - rect.left - pad.left) / (rect.width - pad.left - pad.right)
  active.value = Math.min(lastIndex.value, Math.max(0, Math.round(ratio * lastIndex.value)))
}

function onKey(event: KeyboardEvent) {
  if (!props.samples.length) return
  const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[event.key]
  let next: number | null = active.value ?? lastIndex.value
  if (step) next += step
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = lastIndex.value
  else if (event.key === 'Escape') next = null
  else return
  event.preventDefault()
  active.value = next === null ? null : Math.min(lastIndex.value, Math.max(0, next))
  const sample = active.value === null ? null : props.samples[active.value]
  keyboardText.value = sample ? `${formatClock(sample.at)} ${format(sample.value)}` : ''
}

const tooltipLeft = computed(() => (active.value === null ? 0 : Math.min(x(active.value), width.value - 150)))
</script>

<template>
  <figure class="chart" :class="{ 'chart--loading': loading }">
    <div
      ref="box"
      class="chart__plot"
      tabindex="0"
      role="group"
      :aria-label="`${label} 그래프. 화살표 키로 시각을 옮기며 값을 읽을 수 있습니다.`"
      :aria-describedby="`${id}-summary`"
      @keydown="onKey"
      @blur="active = null"
    >
      <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="summary" @pointermove="pick" @pointerleave="active = null">
        <g class="chart__grid">
          <line v-for="tick in yTicks" :key="tick" :x1="pad.left" :x2="width - pad.right" :y1="y(tick)" :y2="y(tick)" />
        </g>
        <g class="chart__axis" aria-hidden="true">
          <text v-for="tick in yTicks" :key="`y${tick}`" :x="pad.left - 8" :y="y(tick) + 4" text-anchor="end">{{ formatNumber(tick, precision) }}</text>
          <text v-for="index in xTicks" :key="`x${index}`" :x="x(index)" :y="height - 8" text-anchor="middle">
            {{ formatClock(samples[index]!.at).slice(0, 5) }}
          </text>
        </g>
        <g v-for="threshold in thresholds" :key="threshold.label" :class="['chart__threshold', `chart__threshold--${threshold.tone}`]">
          <line :x1="pad.left" :x2="width - pad.right" :y1="y(threshold.value)" :y2="y(threshold.value)" />
          <line class="chart__threshold-key" :x1="width - pad.right + 6" :x2="width - pad.right + 14" :y1="y(threshold.value)" :y2="y(threshold.value)" />
          <text :x="width - pad.right + 18" :y="y(threshold.value) + 4">{{ threshold.label }}</text>
        </g>
        <path class="chart__line" :d="path" />
        <template v-if="last">
          <circle class="chart__end" :cx="x(lastIndex)" :cy="y(last.value)" r="4" />
          <text class="chart__end-label" :x="x(lastIndex) + 8" :y="y(last.value) - 8">{{ format(last.value) }}</text>
        </template>
        <g v-if="pointed && active !== null" class="chart__cross">
          <line :x1="x(active)" :x2="x(active)" :y1="pad.top" :y2="height - pad.bottom" />
          <circle :cx="x(active)" :cy="y(pointed.value)" r="4" />
        </g>
      </svg>
      <div v-if="pointed" class="chart__tooltip" :style="{ left: `${tooltipLeft}px` }" aria-hidden="true">
        <strong class="tabular">{{ format(pointed.value) }}</strong>
        <span>{{ formatClock(pointed.at) }}</span>
      </div>
      <p class="visually-hidden" aria-live="polite">{{ keyboardText }}</p>
    </div>
    <figcaption :id="`${id}-summary`" class="chart__caption">{{ summary }}</figcaption>
    <details class="chart__table">
      <summary>표로 보기</summary>
      <div class="chart__table-wrap" role="region" tabindex="0" :aria-label="`${label} 기록 표`">
        <table>
          <caption class="visually-hidden">{{ label }} 기록</caption>
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">값({{ unit }})</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sample in samples" :key="sample.at">
              <th scope="row"><time :datetime="toIsoString(sample.at)" class="tabular">{{ formatClock(sample.at) }}</time></th>
              <td class="tabular">{{ formatNumber(sample.value, precision) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </figure>
</template>

<style scoped>
.chart {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  transition: opacity 0.2s;
}

.chart--loading .chart__plot {
  opacity: 0.55;
}

.chart__plot {
  position: relative;
  min-width: 0;
  overflow: hidden;
  cursor: crosshair;
}

.chart__plot:focus-visible {
  outline-offset: 4px;
}

.chart__plot svg {
  display: block;
}

.chart__grid line {
  stroke: var(--color-line);
  stroke-width: 1;
}

.chart__axis text,
.chart__threshold text {
  fill: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.chart__threshold line {
  stroke-width: 1;
}

.chart__threshold-key {
  stroke-width: 2 !important;
}

.chart__threshold--warning line {
  stroke: var(--color-warning);
}

.chart__threshold--critical line {
  stroke: var(--color-critical);
}

.chart__line {
  fill: none;
  stroke: var(--color-text);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.chart__end,
.chart__cross circle {
  fill: var(--color-text);
  stroke: var(--color-surface);
  stroke-width: 2;
}

.chart__end-label {
  fill: var(--color-text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}

.chart__cross line {
  stroke: var(--color-text-muted);
  stroke-width: 1;
}

.chart__tooltip {
  position: absolute;
  top: 4px;
  display: grid;
  min-width: 8rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-line-strong);
  background: rgb(0 0 0 / 0.88);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  pointer-events: none;
}

.chart__tooltip strong {
  font-family: var(--font-mono);
  font-size: 1rem;
  color: var(--color-text);
}

.chart__caption {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.chart__table summary {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  cursor: pointer;
  font-size: 0.875rem;
}

.chart__table-wrap {
  max-height: 16rem;
  overflow: auto;
}

.chart__table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.chart__table th,
.chart__table td {
  padding: var(--space-1) var(--space-3);
  border-bottom: 1px solid var(--color-line);
  text-align: left;
  font-weight: 400;
}
</style>
