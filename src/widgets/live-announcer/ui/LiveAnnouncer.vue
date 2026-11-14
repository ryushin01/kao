<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FleetFrame } from '@shared/api'
import { MODEL_PROFILES } from '@entities/vehicle'

/**
 * 새 문제와 조치 결과를 화면 낭독기에 알립니다. 0.5초마다 오는 수치 변화는 알리지 않습니다.
 * 위험 등급의 새 문제와 조치 실패(차량이 적용하지 못했거나 응답이 없음)는 바로 다시 조치해야 하므로 role="alert",
 * 나머지는 role="status"로 보냅니다.
 */
const props = defineProps<{ frame: FleetFrame | null }>()

const politeMessage = ref('')
const urgentMessage = ref('')
let knownIssues: Set<string> | null = null
let knownLog: Set<string> | null = null

watch(
  () => props.frame,
  (frame) => {
    if (!frame) return
    const issues = frame.vehicles.flatMap((vehicle) =>
      vehicle.issues.map((issue) => ({ issue, name: MODEL_PROFILES[vehicle.modelId].shortName })),
    )
    const escalated = issues.filter(({ issue }) => issue.status !== 'resolved').map(({ issue }) => `${issue.id}:${issue.severity}`)
    if (knownIssues && knownLog) {
      const fresh = issues.filter(
        ({ issue }) => issue.status !== 'resolved' && !knownIssues!.has(`${issue.id}:${issue.severity}`),
      )
      const critical = fresh.filter(({ issue }) => issue.severity === 'critical')
      const warning = fresh.filter(({ issue }) => issue.severity === 'warning')
      const newEntries = frame.log.filter((entry) => !knownLog!.has(entry.id))
      const failed = newEntries.filter((entry) => entry.phase === 'failed')
      const urgent = [...critical.map(({ issue, name }) => `위험: ${name} ${issue.title}`), ...failed.map((entry) => `실패: ${entry.message}`)]
      if (urgent.length) urgentMessage.value = urgent.join('. ')
      const completed = newEntries.filter((entry) => entry.phase === 'completed')
      const polite = [
        ...warning.map(({ issue, name }) => `경고: ${name} ${issue.title}`),
        ...completed.map((entry) => entry.message),
      ]
      if (polite.length) politeMessage.value = polite.join('. ')
    }
    knownIssues = new Set(escalated)
    knownLog = new Set(frame.log.map((entry) => entry.id))
  },
  { immediate: true },
)
</script>

<template>
  <div class="visually-hidden">
    <p role="status">{{ politeMessage }}</p>
    <p role="alert">{{ urgentMessage }}</p>
  </div>
</template>
