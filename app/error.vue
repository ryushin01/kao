<script setup lang="ts">
import type { NuxtError } from '#app'
import { NotFoundPage } from '@pages/not-found'

defineProps<{ error: NuxtError }>()
</script>

<template>
  <NotFoundPage :error="error" />
</template>
