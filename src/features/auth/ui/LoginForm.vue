<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, FLEET_SIZE } from '@shared/api'
import type { LoginRequest, SessionUser } from '@shared/api'
import { HudButton } from '@shared/ui'
import { useLogin } from '../model/use-login'

const props = defineProps<{ send?: (body: LoginRequest) => Promise<{ user: SessionUser }> }>()
const emit = defineEmits<{ success: [user: SessionUser] }>()

const id = useId()
const login = ref('')
const password = ref('')
const loginInput = ref<HTMLInputElement | null>(null)
const missing = ref<{ login: boolean; password: boolean }>({ login: false, password: false })
const { mutate, isPending, error } = useLogin({ send: props.send, onSuccess: (user) => emit('success', user) })

const loginError = computed(() => (missing.value.login ? '아이디를 입력해 주세요. 데모 계정은 아래 표에 있습니다.' : ''))
const passwordError = computed(() => (missing.value.password ? '비밀번호를 입력해 주세요.' : ''))

async function submit() {
  missing.value = { login: !login.value.trim(), password: !password.value }
  if (missing.value.login || missing.value.password) {
    await nextTick()
    // 첫 오류 칸으로 초점을 옮깁니다.
    ;(document.getElementById(missing.value.login ? `${id}-login` : `${id}-password`) as HTMLInputElement | null)?.focus()
    return
  }
  await mutate({ login: login.value.trim(), password: password.value })
}

function useDemo(account: string) {
  login.value = account
  password.value = DEMO_PASSWORD
  missing.value = { login: false, password: false }
  void mutate({ login: account, password: DEMO_PASSWORD })
}
</script>

<template>
  <div class="login">
    <form class="login__form" novalidate :aria-describedby="`${id}-error`" @submit.prevent="submit">
      <div class="login__field">
        <label :for="`${id}-login`">아이디</label>
        <input
          :id="`${id}-login`"
          ref="loginInput"
          v-model="login"
          name="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          :aria-invalid="missing.login ? 'true' : undefined"
          :aria-describedby="missing.login ? `${id}-login-error` : undefined"
          :aria-errormessage="missing.login ? `${id}-login-error` : undefined"
        >
        <p v-if="loginError" :id="`${id}-login-error`" class="login__field-error">{{ loginError }}</p>
      </div>
      <div class="login__field">
        <label :for="`${id}-password`">비밀번호</label>
        <input
          :id="`${id}-password`"
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          :aria-invalid="missing.password ? 'true' : undefined"
          :aria-describedby="missing.password ? `${id}-password-error` : undefined"
          :aria-errormessage="missing.password ? `${id}-password-error` : undefined"
        >
        <p v-if="passwordError" :id="`${id}-password-error`" class="login__field-error">{{ passwordError }}</p>
      </div>
      <p :id="`${id}-error`" role="alert" class="login__error">{{ error ?? '' }}</p>
      <HudButton type="submit" variant="primary" :disabled="isPending">
        {{ isPending ? '로그인하는 중…' : '로그인' }}
      </HudButton>
    </form>

    <section class="login__demo" :aria-labelledby="`${id}-demo`">
      <h2 :id="`${id}-demo`" class="login__demo-title">데모 계정으로 바로 로그인</h2>
      <p class="login__demo-note">
        모든 계정의 비밀번호는 <code>{{ DEMO_PASSWORD }}</code>입니다. 관제 요원은 {{ FLEET_SIZE }}대 전체를, 회원은 자기 탈것만 봅니다.
      </p>
      <ul>
        <li v-for="account in DEMO_ACCOUNTS" :key="account.login">
          <HudButton :disabled="isPending" @click="useDemo(account.login)">
            {{ account.name }}<span class="visually-hidden">(으)로 로그인</span>
          </HudButton>
          <span class="login__demo-desc">
            <code>{{ account.login }}</code> · {{ account.description }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  gap: var(--space-8);
}

.login__form {
  display: grid;
  gap: var(--space-4);
}

.login__field {
  display: grid;
  gap: var(--space-2);
}

.login__field label {
  font-size: 0.875rem;
}

.login__field input {
  min-height: 3rem;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-line-strong);
  border-radius: 0;
  background: var(--color-surface-raised);
  font-size: 1rem;
}

.login__field input:focus-visible {
  border-color: var(--color-crimson-text);
}

.login__field input[aria-invalid='true'] {
  border-color: var(--color-critical);
}

.login__field-error,
.login__error {
  font-size: 0.875rem;
  color: var(--color-critical);
}

.login__error:empty {
  display: none;
}

.login__demo {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-line);
}

.login__demo-title {
  font-size: 1.125rem;
}

.login__demo-note,
.login__demo-desc {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.login__demo ul {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.login__demo li {
  display: grid;
  grid-template-columns: 9rem 1fr;
  align-items: center;
  gap: var(--space-3);
}

code {
  font-family: var(--font-mono);
  color: var(--color-text);
}
</style>
