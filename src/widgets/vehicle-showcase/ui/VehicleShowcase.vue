<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { VehicleSnapshot } from '@shared/api'
import { isWebGLAvailable, useMotion } from '@shared/lib'
import { HudButton } from '@shared/ui'
import { MODEL_PROFILES } from '@entities/vehicle'
import type { ShowcaseScene } from '../lib/showcase-scene'

const props = withDefaults(
  defineProps<{
    vehicle: Pick<VehicleSnapshot, 'modelId' | 'paint' | 'speed' | 'metrics' | 'maker'>
    controls?: boolean
  }>(),
  { controls: true },
)

const canvas = ref<HTMLCanvasElement | null>(null)
const supported = ref(true)
const scene = shallowRef<ShowcaseScene | null>(null)
const { paused } = useMotion()

const profile = computed(() => MODEL_PROFILES[props.vehicle.modelId])
const label = computed(
  () => `${profile.value.displayName} 미니어처, ${props.vehicle.paint.name} 색상. 턴테이블 위 3D 모델`,
)

onMounted(async () => {
  if (!canvas.value || !isWebGLAvailable()) {
    supported.value = false
    return
  }
  const { createShowcaseScene } = await import('../lib/showcase-scene')
  if (!canvas.value) return
  scene.value = createShowcaseScene({ canvas: canvas.value, vehicle: props.vehicle, playing: !paused.value })
})

watch(
  () => props.vehicle,
  (vehicle) => scene.value?.setVehicle(vehicle),
)
watch(paused, (value) => scene.value?.setPlaying(!value))

onBeforeUnmount(() => {
  scene.value?.dispose()
  scene.value = null
})
</script>

<template>
  <div class="showcase">
    <div class="showcase__stage">
      <canvas v-if="supported" ref="canvas" class="showcase__canvas" role="img" :aria-label="label" />
      <p v-else class="showcase__fallback">이 브라우저에서는 3D 미니어처를 그릴 수 없습니다(WebGL 미지원).</p>
    </div>
    <div v-if="controls && supported" class="showcase__controls">
      <HudButton size="sm" @click="scene?.rotateBy(-Math.PI / 6)">
        <span aria-hidden="true">←</span> 왼쪽으로 돌리기
      </HudButton>
      <HudButton size="sm" @click="scene?.rotateBy(Math.PI / 6)">
        오른쪽으로 돌리기 <span aria-hidden="true">→</span>
      </HudButton>
      <HudButton size="sm" @click="scene?.reset()">처음 시점</HudButton>
    </div>
  </div>
</template>

<style scoped>
.showcase {
  display: grid;
  gap: var(--space-3);
}

.showcase__stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  background:
    radial-gradient(ellipse at 50% 70%, rgb(139 0 0 / 0.35), transparent 60%),
    radial-gradient(ellipse at 50% 0%, #120808, #000 70%);
}

.showcase__canvas {
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}

.showcase__canvas:active {
  cursor: grabbing;
}

.showcase__fallback {
  padding: var(--space-8);
  color: var(--color-text-muted);
}

.showcase__controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
