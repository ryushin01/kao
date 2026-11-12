<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FleetFrame } from '@shared/api'
import { MODEL_PROFILES } from '@entities/vehicle'

/**
 * 새 문제와 조치 완료를 화면 낭독기에 알립니다. 0.5초마다 오는 수치 변화는 알리지 않습니다.
 * 위험 등급의 새 문제만 role="alert", 나머지는 role="status"로 보냅니다.
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
      if (critical.length) {
        urgentMessage.value = critical.map(({ issue, name }) => `위험: ${name} ${issue.title}`).join('. ')
      }
      const completed = frame.log.filter((entry) => entry.phase === 'completed' && !knownLog!.has(entry.id))
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
