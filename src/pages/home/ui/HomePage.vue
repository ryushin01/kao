<script setup lang="ts">
import { computed, ref } from 'vue'
import { NuxtLink } from '#components'
import { useFetch, useHead } from '#imports'
import { ACTIONS } from '@shared/api'
import type { ActionCode, ShowroomResponse, VehicleKind } from '@shared/api'
import { HudPanel, StatusBadge } from '@shared/ui'
import { CATEGORY_LABELS, MODEL_PROFILES, VEHICLE_CATEGORIES } from '@entities/vehicle'
import { EventHorizon } from '@widgets/event-horizon'
import { VehicleShowcase } from '@widgets/vehicle-showcase'

useHead({ title: 'KAO — 돌이킬 수 없는 지점에 닿기 전에' })

const { data } = await useFetch<ShowroomResponse>('/api/showroom', { key: 'showroom' })
const vehicles = computed(() => data.value?.vehicles ?? [])
const summary = computed(() => data.value?.summary ?? null)
// 분류를 고르면 그 분류의 대표 모델을 턴테이블에 올립니다.
const selectedKind = ref<VehicleKind>('supercar')
const category = computed(() => VEHICLE_CATEGORIES.find((item) => item.kind === selectedKind.value)!)
const selected = computed(
  () => vehicles.value.find((vehicle) => vehicle.modelId === category.value.representative) ?? vehicles.value[0],
)

const actionCodes = Object.keys(ACTIONS) as ActionCode[]
const chapters = [
  { id: 'observe', no: '01', en: 'Observe' },
  { id: 'detect', no: '02', en: 'Detect' },
  { id: 'intervene', no: '03', en: 'Intervene' },
  { id: 'miniature', no: '04', en: 'Miniature' },
] as const
</script>

<template>
  <div class="home">
    <EventHorizon />

    <section class="hero" aria-labelledby="hero-title">
      <p class="hud-label hero__eyebrow">Kinetic Aero One · 실시간 탈것 관제</p>
      <h1 id="hero-title" class="hero__title">
        돌이킬 수 없는 지점에<br >
        <span class="hero__accent">닿기 전에</span>
      </h1>
      <p class="hero__lead">
        KAO는 회원의 자동차·모터사이클·자전거가 달리는 동안 상태를 0.5초마다 받아 봅니다. 문제가 사건의 지평선을
        넘기 전에 찾아내고, 관제 센터에서 원격으로 조치합니다.
      </p>
      <div class="hero__cta">
        <NuxtLink to="/fleet" class="cta cta--primary">관제 센터 열기</NuxtLink>
        <a href="#observe" class="cta">작동 방식 보기</a>
      </div>
      <p class="hero__note">관제 센터는 로그인 화면의 데모 계정으로 바로 들어갈 수 있습니다.</p>
      <dl v-if="summary" class="hero__stats">
        <div>
          <dt class="hud-label">등록 탈것</dt>
          <dd class="tabular">{{ summary.vehicles }}<span>대</span></dd>
        </div>
        <div>
          <dt class="hud-label">조치 필요</dt>
          <dd class="tabular">{{ summary.open }}<span>건</span></dd>
        </div>
        <div>
          <dt class="hud-label">수신 간격</dt>
          <dd class="tabular">0.5<span>초</span></dd>
        </div>
      </dl>
      <nav class="hero__chapters" aria-label="소개 차례">
        <ol>
          <li v-for="chapter in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`">
              <span class="tabular">{{ chapter.no }}</span>
              {{ chapter.en }}
            </a>
          </li>
        </ol>
      </nav>
    </section>

    <section id="observe" class="chapter" aria-labelledby="observe-title">
      <HudPanel as="div" class="chapter__panel">
        <p class="hud-label">01 / 04 · Observe</p>
        <h2 id="observe-title" class="chapter__title">관측: 달리는 동안 계속 봅니다</h2>
        <p class="chapter__text">
          등록된 탈것마다 다른 센서를 읽습니다. 세단은 냉각수와 12V 배터리, 슈퍼카는 엔진오일과 카본 세라믹 브레이크,
          슈퍼바이크는 기울기 각도, 자전거는 벨트 장력과 트래커 배터리까지 봅니다.
        </p>
        <ul class="chapter__list">
          <li v-for="vehicle in vehicles" :key="vehicle.id">
            <strong>{{ CATEGORY_LABELS[vehicle.kind] }} · {{ MODEL_PROFILES[vehicle.modelId].displayName }}</strong>
            <span>{{ vehicle.metrics.map((metric) => metric.label).join(' · ') }}</span>
          </li>
        </ul>
      </HudPanel>
    </section>

    <section id="detect" class="chapter chapter--right" aria-labelledby="detect-title">
      <HudPanel as="div" class="chapter__panel">
        <p class="hud-label">02 / 04 · Detect</p>
        <h2 id="detect-title" class="chapter__title">감지: 두 개의 경계선</h2>
        <p class="chapter__text">
          지표마다 경고와 위험 두 기준이 있습니다. 경고선을 넘으면 문제를 열고, 위험선을 넘으면 등급을 올려 관제 센터와
          화면 낭독기에 바로 알립니다. 상태는 색과 글자, 모양으로 함께 보여 줍니다.
        </p>
        <ul class="chapter__badges">
          <li><StatusBadge state="nominal" /> 기준 안</li>
          <li><StatusBadge state="warning" /> 경고선 넘음</li>
          <li><StatusBadge state="critical" /> 위험선 넘음</li>
        </ul>
      </HudPanel>
    </section>

    <section id="intervene" class="chapter" aria-labelledby="intervene-title">
      <HudPanel as="div" class="chapter__panel">
        <p class="hud-label">03 / 04 · Intervene</p>
        <h2 id="intervene-title" class="chapter__title">조치: 멀리서, 확인한 다음에</h2>
        <p class="chapter__text">
          문제마다 쓸 수 있는 원격 조치를 제안합니다. 명령은 한 번 더 확인한 뒤에만 보내고, 두 번 눌러도 한 번만 갑니다.
        </p>
        <dl class="chapter__actions">
          <div v-for="code in actionCodes" :key="code">
            <dt>{{ ACTIONS[code].label }}</dt>
            <dd>{{ ACTIONS[code].description }}</dd>
          </div>
        </dl>
      </HudPanel>
    </section>

    <section id="miniature" class="chapter chapter--wide" aria-labelledby="miniature-title">
      <HudPanel as="div" class="chapter__panel chapter__panel--split">
        <div class="chapter__intro">
          <p class="hud-label">04 / 04 · Miniature</p>
          <h2 id="miniature-title" class="chapter__title">미니어처: 같은 모양으로 따라갑니다</h2>
          <p class="chapter__text">
            세단·슈퍼카·슈퍼바이크·자전거 네 분류마다 대표 모델을 실제 모양 그대로 미니어처로 만들었습니다. 바퀴는
            실제 속도에 맞춰 구르고, 모터사이클은 코너에서 기울기 센서 값만큼 눕습니다.
          </p>
          <fieldset v-if="vehicles.length" class="model-picker">
            <legend class="hud-label">분류 고르기</legend>
            <label v-for="item in VEHICLE_CATEGORIES" :key="item.kind">
              <input v-model="selectedKind" type="radio" name="home-category" :value="item.kind" >
              <span>
                <strong>{{ item.label }}</strong>
                <small>{{ MODEL_PROFILES[item.representative].displayName }}</small>
              </span>
            </label>
          </fieldset>
          <dl v-if="selected" class="spec">
            <div class="spec__wide">
              <dt>분류 · 대표 모델</dt>
              <dd>{{ category.label }} · {{ MODEL_PROFILES[selected.modelId].displayName }}</dd>
            </div>
            <div class="spec__wide">
              <dt>분류 설명</dt>
              <dd class="spec__text">{{ category.description }}</dd>
            </div>
            <div v-for="spec in MODEL_PROFILES[selected.modelId].specs" :key="spec.label">
              <dt>{{ spec.label }}</dt>
              <dd>{{ spec.value }}</dd>
            </div>
          </dl>
        </div>
        <VehicleShowcase v-if="selected" :vehicle="selected" />
      </HudPanel>
    </section>

    <section class="finale" aria-labelledby="finale-title">
      <p class="hud-label">Cross the horizon</p>
      <h2 id="finale-title" class="finale__title">지금 달리고 있는 4대를 보러 가세요</h2>
      <NuxtLink to="/fleet" class="cta cta--primary">관제 센터 열기</NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.home {
  position: relative;
}

.hero,
.chapter,
.finale {
  position: relative;
  z-index: 1;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 0 var(--gutter);
}

.hero {
  display: grid;
  align-content: center;
  gap: var(--space-6);
  min-height: calc(100svh - var(--header-height));
  padding-block: var(--space-16);
}

.hero__title {
  max-width: 14ch;
  font-size: clamp(2.75rem, 8vw, 6.5rem);
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.04em;
  text-shadow: 0 0 40px #000;
}

.hero__accent {
  color: var(--color-crimson-text);
}

.hero__lead {
  max-width: 36rem;
  font-size: clamp(1rem, 1.6vw, 1.1875rem);
  text-shadow: 0 0 18px #000, 0 0 4px #000;
}

.hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.cta {
  display: inline-flex;
  align-items: center;
  min-height: 3rem;
  padding: 0 var(--space-6);
  border: 1px solid var(--color-line-strong);
  background: rgb(0 0 0 / 0.6);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: border-color 0.2s var(--ease-out);
}

.cta:hover {
  border-color: var(--color-crimson-text);
}

.cta--primary {
  border-color: var(--color-crimson);
  background: var(--color-crimson);
  color: #fff;
}

.hero__note {
  margin-top: calc(var(--space-3) * -1);
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-shadow: 0 0 12px #000;
}

.hero__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  margin: var(--space-4) 0 0;
}

.hero__stats dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 2rem;
}

.hero__stats dd span {
  margin-left: 0.2em;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.hero__chapters ol {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
  margin: 0;
  padding: var(--space-4) 0 0;
  border-top: 1px solid var(--color-line);
  list-style: none;
}

.hero__chapters a {
  display: inline-flex;
  gap: var(--space-2);
  min-height: 2.75rem;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--color-text-muted);
}

.hero__chapters a span {
  color: var(--color-crimson-text);
}

.hero__chapters a:hover {
  color: var(--color-text);
}

.chapter {
  display: grid;
  align-items: center;
  min-height: 92svh;
  padding-block: var(--space-16);
}

.chapter__panel {
  display: grid;
  gap: var(--space-4);
  max-width: 40rem;
  background: rgb(4 2 2 / 0.86);
  backdrop-filter: blur(6px);
}

.chapter--right .chapter__panel {
  justify-self: end;
}

.chapter--wide .chapter__panel {
  max-width: none;
}

.chapter__panel--split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  align-items: start;
  gap: var(--space-8);
}

@media (width < 60rem) {
  .chapter__panel--split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.chapter__intro {
  display: grid;
  gap: var(--space-4);
}

.chapter__title {
  font-size: clamp(1.75rem, 4vw, 2.75rem);
}

.chapter__text {
  color: var(--color-text-muted);
}

.chapter__list,
.chapter__badges {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.chapter__list li {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-line);
}

.chapter__list span {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.chapter__badges li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.chapter__actions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.chapter__actions div {
  padding: var(--space-3);
  border: 1px solid var(--color-line);
}

.chapter__actions dt {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--color-crimson-text);
}

.chapter__actions dd {
  margin: var(--space-1) 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.model-picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.model-picker legend {
  float: left;
  width: 100%;
  margin-bottom: var(--space-2);
}

.model-picker label {
  position: relative;
}

.model-picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.model-picker span {
  display: inline-grid;
  align-content: center;
  min-height: 2.75rem;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-line-strong);
  font-size: 0.875rem;
  line-height: 1.3;
}

.model-picker strong {
  font-weight: 600;
}

.model-picker small {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.model-picker input:checked + span small {
  color: #fff;
}

.spec__wide {
  grid-column: 1 / -1;
}

.spec__text {
  font-family: var(--font-sans) !important;
  font-size: 0.875rem;
}

.model-picker input:checked + span {
  border-color: var(--color-crimson);
  background: var(--color-crimson);
  color: #fff;
}

.model-picker input:focus-visible + span {
  outline: 2px solid var(--color-crimson-text);
  outline-offset: 3px;
}

.spec {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.spec dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.spec dd {
  margin: 0;
  font-family: var(--font-mono);
}

.finale {
  display: grid;
  justify-items: center;
  gap: var(--space-6);
  min-height: 80svh;
  align-content: center;
  text-align: center;
}

.finale__title {
  max-width: 18ch;
  font-size: clamp(2rem, 5vw, 3.5rem);
  text-shadow: 0 0 30px #000;
}
</style>
