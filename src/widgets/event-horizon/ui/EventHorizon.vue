<script setup lang="ts">
import { Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createStage, isWebGLAvailable, useMotion } from '@shared/lib'
import type { Stage } from '@shared/lib'
import { fragmentShader, vertexShader } from '../lib/shaders'

/**
 * 스크롤할수록 블랙홀(사건의 지평선)에 다가가는 배경입니다. 꾸밈용이라 보조기기에서는 숨깁니다.
 */
const canvas = ref<HTMLCanvasElement | null>(null)
const supported = ref(true)
const { paused } = useMotion()
let stage: Stage | null = null
let material: ShaderMaterial | null = null
let target = 0
let current = 0

const readScroll = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight
  target = max > 0 ? Math.min(1, window.scrollY / max) : 0
  if (paused.value) {
    current = target
    stage?.invalidate()
  }
}

onMounted(() => {
  if (!canvas.value || !isWebGLAvailable()) {
    supported.value = false
    return
  }
  material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
  })
  let time = 12
  stage = createStage({
    canvas: canvas.value,
    onFrame(delta) {
      if (!material || !stage) return
      if (!paused.value) {
        time += delta
        current += (target - current) * Math.min(1, delta * 3)
      }
      stage.renderer.getDrawingBufferSize(material.uniforms.uResolution!.value as Vector2)
      material.uniforms.uTime!.value = time
      material.uniforms.uProgress!.value = current
    },
  })
  stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  const quad = new Mesh(new PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  stage.scene.add(quad)
  stage.setPlaying(!paused.value)
  readScroll()
  window.addEventListener('scroll', readScroll, { passive: true })
})

watch(paused, (value) => stage?.setPlaying(!value))

onBeforeUnmount(() => {
  window.removeEventListener('scroll', readScroll)
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div class="event-horizon" aria-hidden="true">
    <canvas v-if="supported" ref="canvas" class="event-horizon__canvas" />
    <div v-else class="event-horizon__fallback" />
  </div>
</template>

<style scoped>
.event-horizon {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--color-void);
}

.event-horizon__canvas {
  width: 100%;
  height: 100%;
}

.event-horizon__fallback {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 50%, #000 0 9vmin, transparent 9.5vmin),
    radial-gradient(ellipse 34vmin 8vmin at 50% 52%, rgb(255 120 80 / 0.7), rgb(139 0 0 / 0.5) 45%, transparent 70%),
    radial-gradient(circle at 50% 50%, rgb(139 0 0 / 0.45), transparent 45vmin),
    #000;
}
</style>
