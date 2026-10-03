/** 试验班组与试验人花名册：归属判定、身份切换、交接班选择都从这里取，不在页面里写死。 */

export const CREW_TESTERS: Record<string, string[]> = {
  保护试验一班: ['李志强', '陈晓东'],
  保护试验二班: ['王海涛', '赵敏'],
  保护校验班: ['孙鹏', '周蕾'],
}

export const CREWS = Object.keys(CREW_TESTERS)

export function crewOfTester(tester: string): string {
  const hit = Object.entries(CREW_TESTERS).find(([, testers]) => testers.includes(tester))
  return hit ? hit[0] : ''
}
