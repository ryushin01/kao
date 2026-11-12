<script setup lang="ts">
import { MODEL_ASSETS } from '@entities/vehicle'

const credits = Object.values(MODEL_ASSETS).map((asset) => asset!.credit)
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="hud-label">KAO · Kinetic Aero One</p>
      <p>
        이 화면의 회원, 등록번호, 주행 기록은 모두 시뮬레이션으로 만든 가상 데이터입니다.
        제조사 이름과 모델명은 등록 탈것을 구분하려고 적었으며, 각 상표는 해당 회사의 것입니다.
      </p>
      <section class="site-footer__credits" aria-labelledby="credits-title">
        <h2 id="credits-title" class="hud-label">3D 모델 출처</h2>
        <ul>
          <li v-for="credit in credits" :key="credit.source">
            <a :href="credit.source" rel="noopener" target="_blank">{{ credit.title }}<span class="visually-hidden"> (새 창)</span></a>
            ·
            <a :href="credit.authorUrl" rel="noopener" target="_blank">{{ credit.author }}<span class="visually-hidden"> (새 창)</span></a>
            ·
            <a :href="credit.licenseUrl" rel="noopener license" target="_blank">{{ credit.license }}<span class="visually-hidden"> (새 창)</span></a>
            · 크기·방향 조정, 바퀴 분리, 도장 색 변경, 압축
          </li>
        </ul>
        <p>STRiDA LT 미니어처는 Three.js 코드로 직접 만들었습니다.</p>
      </section>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  position: relative;
  z-index: 1;
  border-top: 1px solid var(--color-line);
  background: var(--color-void);
}

.site-footer__inner {
  display: grid;
  gap: var(--space-2);
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--space-8) var(--gutter);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.site-footer__credits {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.site-footer__credits h2 {
  margin: 0;
  font-weight: 400;
}

.site-footer__credits ul {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-footer__credits a {
  display: inline-block;
  padding-block: 0.375rem;
  color: var(--color-text);
}
</style>
