// 班组与试验人花名册：试验记录按班组归属，只有本班组试验人能改试验口径数据。
// 纯前端演示版没有登录服务，页面上可切换当前班组/试验人来模拟不同账号。
export type Team = {
  key: string
  name: string
  testers: string[]
}

export const TEST_TEAMS: Team[] = [
  { key: 'insulation-1', name: '保护试验一班', testers: ['王建国', '李志强'] },
  { key: 'insulation-2', name: '保护试验二班', testers: ['赵海涛', '孙鹏飞'] },
  { key: 'insulation-3', name: '高压试验班', testers: ['周文斌', '吴明辉'] },
]

export const DEFAULT_TEAM_KEY = 'insulation-1'
export const DEFAULT_TESTER = '王建国'

export function teamNameOf(key: string): string {
  return TEST_TEAMS.find((team) => team.key === key)?.name ?? key
}

export function testersOf(teamKey: string): string[] {
  return TEST_TEAMS.find((team) => team.key === teamKey)?.testers ?? []
}

export function findTeamByTester(tester: string): Team | undefined {
  return TEST_TEAMS.find((team) => team.testers.includes(tester))
}
