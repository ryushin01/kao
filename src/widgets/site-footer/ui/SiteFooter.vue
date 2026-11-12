<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="hud-label">KAO · Kinetic Aero One</p>
      <p>
        이 화면의 회원, 등록번호, 주행 기록은 모두 시뮬레이션으로 만든 가상 데이터입니다.
        제조사 이름과 모델명은 등록 탈것을 구분하려고 적었으며, 각 상표는 해당 회사의 것입니다.
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
</style>
