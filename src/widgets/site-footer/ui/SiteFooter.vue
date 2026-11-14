<script setup lang="ts">
/** 3D 모델의 출처(CC BY 4.0)는 화면이 아니라 README에 적고, 여기서는 그 표로 잇습니다. */
const SOURCES_URL = 'https://github.com/ryushin01/kao#출처'
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="hud-label">KAO · Kinetic Aero One</p>
      <p>
        이 화면의 회원, 등록번호, 주행 기록은 모두 시뮬레이션으로 만든 가상 데이터입니다.
        제조사 이름과 모델명은 등록 탈것을 구분하려고 적었으며, 각 상표는 해당 회사의 것입니다.
      </p>
      <p>
        <a class="site-footer__credits" :href="SOURCES_URL">3D 모델 출처 (README)</a>
      </p>
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
  /* 누르기 쉬운 높이를 두던 예전 출처 링크와 같게 */
  display: inline-block;
  padding-block: 0.375rem;
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
</style>
