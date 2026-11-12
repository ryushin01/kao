<script setup lang="ts">
import { ref } from 'vue'
import { logout } from '@shared/api'
import { HudButton } from '@shared/ui'

/** beforeLogout: 세션이 남아 있을 때 정리할 일(예: 이 브라우저의 알림 구독 해지) */
const props = defineProps<{ beforeLogout?: () => Promise<void> }>()
const emit = defineEmits<{ done: [] }>()
const pending = ref(false)
const error = ref('')

async function run() {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    await props.beforeLogout?.().catch(() => {})
    await logout()
    emit('done')
  } catch {
    error.value = '로그아웃하지 못했습니다. 네트워크를 확인하고 다시 눌러 주세요.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <span class="logout">
    <HudButton size="sm" :disabled="pending" @click="run">로그아웃</HudButton>
    <span role="alert" class="logout__error">{{ error }}</span>
  </span>
</template>

<style scoped>
.logout {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.logout__error {
  font-size: 0.75rem;
  color: var(--color-critical);
}
</style>
