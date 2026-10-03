import { defineStore } from 'pinia'

import { DEFAULT_TEAM_KEY, DEFAULT_TESTER, findTeamByTester, teamNameOf } from '@/data/org'

// 当前会话身份：纯前端演示用，可在绝缘试验页切换班组/试验人模拟不同账号登录。
const STORAGE_KEY = 'substation-protection:session'

type PersistedSession = {
  teamKey: string
  tester: string
}

function loadSession(): PersistedSession {
  const fallback = { teamKey: DEFAULT_TEAM_KEY, tester: DEFAULT_TESTER }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSession>
    if (!parsed.tester) {
      return fallback
    }
    // 试验人必须属于所选班组，对不上就按试验人所在班组归位。
    const teamKey = findTeamByTester(parsed.tester)?.key ?? parsed.teamKey ?? fallback.teamKey
    return { teamKey, tester: parsed.tester }
  } catch {
    return fallback
  }
}

export const useSessionStore = defineStore('session', {
  state: () => {
    const initial = loadSession()
    return {
      operator: initial.tester,
      teamKey: initial.teamKey,
      tester: initial.tester,
      shiftLabel: '白班 08:00-20:00',
      scope: '变电站继电保护定值整定与二次设备检修管理平台',
    }
  },
  getters: {
    canOperate: (state) => state.tester.length > 0,
    teamName: (state) => teamNameOf(state.teamKey),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(teamKey: string, tester: string) {
      this.teamKey = teamKey
      this.tester = tester
      this.operator = tester
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamKey, tester }))
      }
    },
  },
})
