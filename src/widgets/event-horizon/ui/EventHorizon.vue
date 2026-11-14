<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isWebGLAvailable, useMotion } from '@shared/lib'
import { createShaderCanvas } from '../lib/shader-canvas'
import type { ShaderCanvas } from '../lib/shader-canvas'
import { fragmentShader } from '../lib/shaders'

/**
 * 스크롤할수록 블랙홀(사건의 지평선)에 다가가는 배경입니다. 꾸밈용이라 보조기기에서는 숨깁니다.
 * 셰이더 하나만 그리므로 three.js 없이 WebGL을 직접 씁니다(소개 화면 첫 로딩에서 three.js를 받지 않음).
 */
const canvas = ref<HTMLCanvasElement | null>(null)
const supported = ref(true)
const { paused } = useMotion()
let stage: ShaderCanvas | null = null
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
  let time = 12
  stage = createShaderCanvas({
    canvas: canvas.value,
    fragmentShader,
    // 전체 화면 셰이더라 픽셀 수가 곧 부하입니다. 흐린 배경이므로 1배 해상도로 충분합니다.
    maxPixelRatio: 1,
    onFrame(delta) {
      if (!paused.value) {
        time += delta
        current += (target - current) * Math.min(1, delta * 3)
      }
      stage?.setUniform('uTime', time)
      stage?.setUniform('uProgress', current)
    },
  })
  if (!stage) {
    supported.value = false
    return
  }
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
