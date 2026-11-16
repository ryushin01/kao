import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../src/shared/api/contract'
import { hashPassword } from '../password'
import type { UserRecord } from './types'

/** 데모 계정. 메모리 저장소와 DB 시드가 같은 값을 씁니다. 비밀번호가 모두 같아 해시는 한 번만 만듭니다(scrypt는 느림). */
export function demoUsers(): UserRecord[] {
  const passwordHash = hashPassword(DEMO_PASSWORD)
  return DEMO_ACCOUNTS.map((account) => ({
    id: `user-${account.login}`,
    login: account.login,
    name: account.name,
    role: account.role,
    vehicleIds: account.vehicleIds,
    passwordHash,
  }))
}
