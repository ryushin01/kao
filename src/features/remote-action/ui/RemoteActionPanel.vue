<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { ACTIONS, ISSUE_STATUS_LABELS } from '@shared/api'
import type { ActionCode, Issue, RemoteActionRequest, RemoteActionResponse } from '@shared/api'
import { formatClock, toIsoString } from '@shared/lib'
import { HudButton, StatusBadge } from '@shared/ui'
import { useRemoteAction } from '../model/use-remote-action'

const props = defineProps<{
  vehicleId: string
  vehicleName: string
  issue: Issue
  send?: (vehicleId: string, body: RemoteActionRequest) => Promise<RemoteActionResponse>
  /** 회원 화면: 조치 버튼 없이 상태만 보여 줍니다(원격 조치는 관제 요원만). */
  readonly?: boolean
}>()
const emit = defineEmits<{ success: [response: RemoteActionResponse] }>()

const id = useId()
const dialog = ref<HTMLDialogElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const chosen = ref<ActionCode | null>(null)
const notice = ref('')

const { mutate, isPending, error } = useRemoteAction({
  send: props.send,
  onSuccess(response) {
    notice.value = `${ACTIONS[response.entry.action].label} 명령을 보냈습니다. 차량 응답을 기다립니다.`
    emit('success', response)
  },
})

const statusLabel = computed(() => ISSUE_STATUS_LABELS[props.issue.status])
const isLive = computed(() => props.issue.source === 'live')
/** 조치 중 안내. 실측 문제는 차량이 명령을 받아 응답해야 하므로 단계별로 알립니다. */
const progressText = computed(() => {
  if (props.issue.stage === 'awaiting') return '차량 응답을 기다리고 있습니다. 2분 안에 응답이 없으면 다시 조치할 수 있습니다.'
  if (props.issue.stage === 'recovering') return '차량이 명령을 적용했습니다. 지표가 기준 안으로 돌아오면 해결됩니다.'
  return '차량이 명령을 적용하고 있습니다.'
})

function ask(action: ActionCode) {
  chosen.value = action
  dialog.value?.showModal()
}

async function confirm() {
  const action = chosen.value
  if (!action) return
  dialog.value?.close()
  // 누른 버튼이 '조치 중' 상태로 사라지므로 초점을 문제 제목으로 옮깁니다.
  await nextTick()
  heading.value?.focus()
  await mutate({ vehicleId: props.vehicleId, issueId: props.issue.id, action })
}
</script>

<template>
  <article class="issue" :data-status="issue.status" :aria-labelledby="`${id}-title`">
    <header class="issue__head">
      <div class="issue__badges">
        <StatusBadge :state="issue.status === 'resolved' ? 'nominal' : issue.severity" :label="issue.status === 'resolved' ? statusLabel : undefined" />
        <span v-if="issue.status !== 'resolved'" class="hud-label">{{ statusLabel }}</span>
        <span v-if="isLive" class="hud-label issue__source">실차 측정</span>
      </div>
      <h3 :id="`${id}-title`" ref="heading" class="issue__title" tabindex="-1">{{ issue.title }}</h3>
      <p class="issue__detail">{{ issue.detail }}</p>
      <p class="issue__time">
        감지 <time :datetime="toIsoString(issue.detectedAt)" class="tabular">{{ formatClock(issue.detectedAt) }}</time>
        <template v-if="issue.resolvedAt && issue.resolvedBy">
          · {{ ACTIONS[issue.resolvedBy].label }}로 해결
          <time :datetime="toIsoString(issue.resolvedAt)" class="tabular">{{ formatClock(issue.resolvedAt) }}</time>
        </template>
      </p>
    </header>

    <p v-if="issue.status === 'open' && readonly" class="issue__readonly">
      관제 센터가 확인하고 있습니다. 원격 조치는 관제 요원이 보냅니다.
    </p>
    <div v-else-if="issue.status === 'open'" class="issue__actions">
      <p :id="`${id}-hint`" class="hud-label">원격 조치</p>
      <ul :aria-labelledby="`${id}-hint`">
        <li v-for="action in issue.actions" :key="action">
          <HudButton
            :variant="action === issue.actions[0] ? 'primary' : 'ghost'"
            size="sm"
            :disabled="isPending"
            :aria-describedby="`${id}-${action}`"
            @click="ask(action)"
          >
            {{ ACTIONS[action].label }}
          </HudButton>
          <p :id="`${id}-${action}`" class="issue__action-desc">{{ ACTIONS[action].description }}</p>
        </li>
      </ul>
    </div>
    <p v-else-if="issue.status === 'resolving'" class="issue__progress">
      <span class="issue__spinner" aria-hidden="true" />
      {{ progressText }}
    </p>

    <div class="issue__live">
      <p role="status" class="issue__notice">{{ notice }}</p>
      <p role="alert" class="issue__error">{{ error ?? '' }}</p>
    </div>

    <dialog
      ref="dialog"
      class="issue__dialog"
      role="alertdialog"
      :aria-labelledby="`${id}-dialog-title`"
      :aria-describedby="`${id}-dialog-desc`"
    >
      <template v-if="chosen">
        <h4 :id="`${id}-dialog-title`" class="issue__dialog-title">{{ ACTIONS[chosen].label }} 명령을 보낼까요?</h4>
        <p :id="`${id}-dialog-desc`">
          {{ vehicleName }} · {{ issue.title }}<br >
          {{ ACTIONS[chosen].description }}
          {{ isLive ? '보내면 차량이 명령을 받아 적용한 뒤 결과를 알려 옵니다.' : '보내면 주행 중인 차량에 바로 적용됩니다.' }}
        </p>
      </template>
      <form method="dialog" class="issue__dialog-buttons">
        <HudButton type="submit">취소</HudButton>
        <HudButton variant="primary" @click="confirm">명령 보내기</HudButton>
      </form>
    </dialog>
  </article>
</template>

<style scoped>
.issue {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-6);
  border: 1px solid var(--color-line);
  background: var(--color-surface-raised);
}

.issue[data-status='open'] {
  border-color: rgb(255 92 77 / 0.55);
}

.issue[data-status='resolved'] {
  opacity: 0.8;
}

.issue__head {
  display: grid;
  gap: var(--space-2);
}

.issue__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.issue__title {
  font-size: 1.25rem;
}

.issue__source {
  padding: 0 var(--space-2);
  border: 1px solid var(--color-line-strong);
}

.issue__title:focus {
  outline: none;
}

.issue__title:focus-visible {
  outline: 2px solid var(--color-crimson-text);
}

.issue__detail,
.issue__time,
.issue__action-desc {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.issue__actions ul {
  display: grid;
  gap: var(--space-3);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.issue__actions li {
  display: grid;
  grid-template-columns: minmax(8.5rem, auto) 1fr;
  align-items: center;
  gap: var(--space-3);
}

@media (width < 30rem) {
  .issue__actions li {
    grid-template-columns: 1fr;
  }
}

.issue__readonly {
  font-size: 0.875rem;
  color: var(--color-warning);
}

.issue__progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-warning);
}

.issue__spinner {
  width: 0.875rem;
  height: 0.875rem;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.issue__live {
  margin-top: calc(var(--space-4) * -1);
}

.issue__live p:not(:empty) {
  margin-top: var(--space-4);
}

.issue__notice {
  font-size: 0.875rem;
}

.issue__error {
  color: var(--color-critical);
  font-size: 0.875rem;
}

.issue__dialog {
  width: min(28rem, calc(100vw - 2rem));
  padding: var(--space-8);
  border: 1px solid var(--color-crimson-text);
  background: var(--color-surface);
  color: var(--color-text);
}

.issue__dialog::backdrop {
  background: rgb(0 0 0 / 0.75);
}

.issue__dialog p {
  margin-top: var(--space-3);
  color: var(--color-text-muted);
}

.issue__dialog-title {
  font-size: 1.25rem;
}

.issue__dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
</style>
