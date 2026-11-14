import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { LoginRequest, SessionUser } from '@shared/api'
import LoginForm from './LoginForm.vue'

const ok = async ({ login }: LoginRequest): Promise<{ user: SessionUser }> => {
  await new Promise((resolve) => setTimeout(resolve, 600))
  return { user: { id: `user-${login}`, login, name: login, role: 'operator', vehicleIds: [] } }
}

const meta = { title: 'features/auth/LoginForm', component: LoginForm, args: { send: ok } } satisfies Meta<typeof LoginForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WrongPassword: Story = {
  args: { send: async () => Promise.reject(new Error('아이디 또는 비밀번호가 맞지 않습니다. 아래 데모 계정을 확인해 주세요.')) },
}
