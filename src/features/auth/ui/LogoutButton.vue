<script setup lang="ts">
import { ref } from 'vue'
import { logout } from '@shared/api'
import { HudButton } from '@shared/ui'

const emit = defineEmits<{ done: [] }>()
const pending = ref(false)

async function run() {
  if (pending.value) return
  pending.value = true
  try {
    await logout()
    emit('done')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <HudButton size="sm" :disabled="pending" @click="run">로그아웃</HudButton>
</template>
