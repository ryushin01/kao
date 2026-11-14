import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../src/shared/api/contract'
import { hashPassword } from '../password'
import type { UserRecord } from './types'

/** 데모 계정. 메모리 저장소와 DB 시드가 같은 값을 씁니다. */
export function demoUsers(): UserRecord[] {
  return DEMO_ACCOUNTS.map((account) => ({
    id: `user-${account.login}`,
    login: account.login,
    name: account.name,
    role: account.role,
    vehicleIds: account.vehicleIds,
    passwordHash: hashPassword(DEMO_PASSWORD),
  }))
}
