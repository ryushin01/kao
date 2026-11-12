<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost'
    size?: 'md' | 'sm'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    pressed?: boolean | undefined
  }>(),
  { variant: 'ghost', size: 'md', type: 'button', disabled: false, pressed: undefined },
)
</script>

<template>
  <button
    :type="type"
    :class="['hud-button', `hud-button--${variant}`, `hud-button--${size}`]"
    :disabled="disabled"
    :aria-pressed="pressed"
  >
    <slot />
  </button>
</template>

<style scoped>
.hud-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 2.75rem;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-line-strong);
  border-radius: 0;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background-color 0.2s var(--ease-out),
    border-color 0.2s var(--ease-out);
}

.hud-button--sm {
  min-height: 2.25rem;
  padding: 0 var(--space-3);
  font-size: 0.75rem;
}

.hud-button--primary {
  background: var(--color-crimson);
  border-color: var(--color-crimson);
  color: #fff;
}

.hud-button--primary:hover:not(:disabled) {
  background: #a30d0d;
  border-color: var(--color-crimson-text);
}

.hud-button--ghost:hover:not(:disabled),
.hud-button[aria-pressed='true'] {
  border-color: var(--color-crimson-text);
  background: var(--color-crimson-deep);
}

.hud-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
