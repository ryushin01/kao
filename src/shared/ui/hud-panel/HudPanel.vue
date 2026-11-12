<script setup lang="ts">
withDefaults(defineProps<{ as?: string; labelledby?: string }>(), { as: 'section', labelledby: undefined })
</script>

<template>
  <component :is="as" class="hud-panel" :aria-labelledby="labelledby">
    <span class="hud-panel__corner hud-panel__corner--tl" aria-hidden="true" />
    <span class="hud-panel__corner hud-panel__corner--br" aria-hidden="true" />
    <slot />
  </component>
</template>

<style scoped>
.hud-panel {
  position: relative;
  min-width: 0;
  padding: var(--space-6);
  border: 1px solid var(--color-line);
  background: linear-gradient(180deg, rgb(139 0 0 / 0.08), transparent 40%), var(--color-surface);
}

.hud-panel__corner {
  position: absolute;
  width: 0.75rem;
  height: 0.75rem;
  border-color: var(--color-crimson-text);
  border-style: solid;
  pointer-events: none;
}

.hud-panel__corner--tl {
  top: -1px;
  left: -1px;
  border-width: 2px 0 0 2px;
}

.hud-panel__corner--br {
  right: -1px;
  bottom: -1px;
  border-width: 0 2px 2px 0;
}
</style>
