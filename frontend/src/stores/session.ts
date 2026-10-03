import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '李志强',
    crew: '保护试验一班',
    shiftLabel: '白班 08:00-20:00',
    scope: '变电站继电保护定值整定与二次设备检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 切换当前试验人身份：试验人与所属班组必须成对出现，归属判定用班组，留痕用试验人。
    setIdentity(operator: string, crew: string) {
      this.operator = operator
      this.crew = crew
    },
  },
})
