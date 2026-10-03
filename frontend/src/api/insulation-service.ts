import { listRows, saveRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import { DEFAULT_TEAM_KEY, teamNameOf, testersOf } from '@/data/org'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

// 绝缘试验领域服务：归属班组管控、判定后只读封存、同设备去重、交接班移交、
// 不合格联动保护装置台账待校验清单，所有操作与退回均留痕。
const KEY = 'insulationtest'
const DEVICE_KEY = 'protectiondevice'

// 归属班组试验人可改的试验口径字段，仅限这三项；其他班组一律退回。
export const TEST_EDITABLE_FIELDS = ['试验设备', '试验电压', '泄漏电流'] as const
export type EditableField = (typeof TEST_EDITABLE_FIELDS)[number]

export type InsulationRecord = EntryRow & {
  teamKey: string
  原试验人: string
  移交记录: string
  修改日志: string
  判定人: string
  判定日期: string
}

const CONCLUDED_STATUSES = ['试验合格', '试验不合格']

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function actor(): { teamKey: string; team: string; tester: string } {
  const session = useSessionStore()
  return { teamKey: session.teamKey, team: session.teamName, tester: session.tester }
}

function tag(): string {
  const who = actor()
  return `[${now()}] ${who.tester}（${who.team}）`
}

function isConcluded(record: EntryRow): boolean {
  return CONCLUDED_STATUSES.includes(String(record.status))
}

// 旧示例数据没有归属字段，首次读取时补齐并落库，保证归属与留痕从这条开始可查。
function normalize(record: EntryRow): InsulationRecord {
  return {
    ...record,
    teamKey: String(record.teamKey ?? DEFAULT_TEAM_KEY),
    所属班组: String(record.所属班组 ?? teamNameOf(DEFAULT_TEAM_KEY)),
    试验人: String(record.试验人 ?? ''),
    原试验人: String(record.原试验人 ?? record.试验人 ?? ''),
    移交记录: String(record.移交记录 ?? ''),
    修改日志: String(record.修改日志 ?? ''),
    判定人: String(record.判定人 ?? ''),
    判定日期: String(record.判定日期 ?? ''),
  }
}

function loadAll(): InsulationRecord[] {
  const rows = listRows(KEY)
  let changed = false
  const normalized = rows.map((row) => {
    const fixed = normalize(row)
    if (JSON.stringify(fixed) !== JSON.stringify(row)) {
      changed = true
    }
    return fixed
  })
  if (changed) {
    saveRows(KEY, normalized)
  }
  return normalized
}

function persist(rows: InsulationRecord[]): void {
  saveRows(KEY, rows)
}

function appendLog(record: InsulationRecord, line: string): void {
  record.修改日志 = record.修改日志 ? `${record.修改日志}\n${line}` : line
}

export function listInsulationTests(filters: Record<string, string> = {}): PageResult {
  const rows = loadAll()
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched = pairs.length
    ? rows.filter((row) =>
        pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
      )
    : rows
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getInsulationTest(id: number): InsulationRecord | undefined {
  return loadAll().find((row) => Number(row.id) === id)
}

export function canEditRecord(record: EntryRow): boolean {
  if (isConcluded(record)) {
    return false
  }
  const who = actor()
  return String(record.teamKey) === who.teamKey
}

export function isRecordConcluded(record: EntryRow): boolean {
  return isConcluded(record)
}

function ownedBy(record: InsulationRecord, who: { teamKey: string }): boolean {
  return record.teamKey === who.teamKey
}

// 登记新试验：同一台设备存在未出结论的记录时只保留一条，重复提交直接退回。
export function createInsulationTest(input: {
  试验设备: string
  试验项目?: string
  试验电压?: string
  泄漏电流?: string
}): ActionResult {
  const who = actor()
  const device = input.试验设备.trim()
  if (!device) {
    return { ok: false, message: '退回：试验设备不能为空' }
  }
  const rows = loadAll()
  const duplicate = rows.find(
    (row) => String(row.试验设备) === device && !isConcluded(row),
  )
  if (duplicate) {
    return {
      ok: false,
      message: `退回：设备「${device}」已有未出结论的试验记录 ${duplicate.试验编号}（状态：${duplicate.status}），同一台设备只落一条，请勿重复提交`,
    }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const record: InsulationRecord = {
    id,
    status: '待试验',
    pending: true,
    abnormal: false,
    teamKey: who.teamKey,
    试验编号: `INSU-${String(id).padStart(4, '0')}`,
    所属班组: who.team,
    试验设备: device,
    试验项目: input.试验项目?.trim() ?? '',
    试验电压: input.试验电压?.trim() ?? '',
    泄漏电流: input.泄漏电流?.trim() ?? '',
    试验人: who.tester,
    原试验人: who.tester,
    试验日期: new Date().toISOString().slice(0, 10),
    试验结论: '',
    判定人: '',
    判定日期: '',
    移交记录: '',
    修改日志: '',
  }
  appendLog(record, `${tag()}登记试验记录，归属班组：${who.team}`)
  persist([...rows, record])
  return { ok: true, message: `试验记录 ${record.试验编号} 已登记，归属${who.team}` }
}

// 修改试验口径字段（试验设备/试验电压/泄漏电流）：列表页与详情页共用本入口，
// 保证两处读到的是同一条数据；非归属班组或已出结论一律退回并写明理由，退回也留痕。
export function updateTestFields(
  id: number,
  patch: Partial<Record<EditableField, string>>,
): ActionResult {
  const who = actor()
  const rows = loadAll()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const record = rows[index]
  const changedFields = TEST_EDITABLE_FIELDS.filter((field) => {
    const next = patch[field]?.trim()
    return next !== undefined && next !== String(record[field] ?? '')
  })
  if (changedFields.length === 0) {
    return { ok: true, message: '试验数据没有变化' }
  }

  let reason = ''
  if (isConcluded(record)) {
    reason = `记录已判定${record.status}（${record.判定日期}），整条只读，试验电压、泄漏电流与试验设备均不能再修改`
  } else if (!ownedBy(record, who)) {
    reason = `该记录归属${record.所属班组}，当前试验人${who.tester}属${who.team}，跨班组无权修改试验电压、泄漏电流与试验设备`
  }
  if (reason) {
    const attempted = changedFields
      .map((field) => `${field}：${String(record[field] ?? '—')} → ${patch[field]?.trim()}`)
      .join('；')
    appendLog(record, `${tag()}跨权修改被退回（${reason}）；拟改内容：${attempted}`)
    persist(rows)
    return { ok: false, message: `已退回：${reason}` }
  }

  const detail = changedFields
    .map((field) => `${field}：${String(record[field] ?? '—')} → ${patch[field]?.trim()}`)
    .join('；')
  for (const field of changedFields) {
    record[field] = patch[field]?.trim() ?? ''
  }
  appendLog(record, `${tag()}修改${detail}`)
  persist(rows)
  return { ok: true, message: `试验记录 ${record.试验编号} 已更新：${detail}` }
}

// 不合格联动：把试验设备写进保护装置台账的待校验清单；同设备只维护一条，不重复挂账。
function syncPendingDevice(equipment: string, testNo: string): string {
  const devices = listRows(DEVICE_KEY)
  const existingIndex = devices.findIndex((row) => String(row.所属间隔) === equipment)
  if (existingIndex >= 0) {
    const device = devices[existingIndex]
    if (String(device.status) === '待校验') {
      return String(device.装置编号)
    }
    devices[existingIndex] = {
      ...device,
      status: '待校验',
      pending: true,
      abnormal: true,
      装置状态: '待校验',
    }
    saveRows(DEVICE_KEY, devices)
    return String(device.装置编号)
  }

  const id = devices.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const deviceNo = `PROT-${String(id).padStart(4, '0')}`
  devices.push({
    id,
    status: '待校验',
    pending: true,
    abnormal: true,
    装置编号: deviceNo,
    所属间隔: equipment,
    装置型号: '待补录',
    保护类型: '绝缘试验不合格待校验',
    投运日期: '',
    校验周期: '',
    上次校验日: '',
    装置状态: '待校验（来源：' + testNo + '）',
  })
  saveRows(DEVICE_KEY, devices)
  return deviceNo
}

// 状态流转：提交试验/判定合格/标记不合格。动作同样只认归属班组；
// 判定合格或不合格即出结论，整条封存只读；不合格同步保护装置待校验清单。
export function runTestAction(id: number, action: string): ActionResult {
  const meta = MODULE_BY_KEY.get(KEY)
  if (!meta) {
    return { ok: false, message: '绝缘试验模块未登记' }
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `试验记录没有登记「${action}」这个动作` }
  }
  const who = actor()
  const rows = loadAll()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const record = rows[index]

  if (isConcluded(record)) {
    const reason = `记录已判定${record.status}（${record.判定日期}），整条只读，不能再执行「${action}」`
    appendLog(record, `${tag()}操作被退回（${reason}）`)
    persist(rows)
    return { ok: false, message: `已退回：${reason}` }
  }
  if (!ownedBy(record, who)) {
    const reason = `该记录归属${record.所属班组}，${who.tester}（${who.team}）跨班组不能执行「${action}」，其他班组仅可查看`
    appendLog(record, `${tag()}跨权操作被退回（${reason}）`)
    persist(rows)
    return { ok: false, message: `已退回：${reason}` }
  }
  if (String(record.status) === target) {
    return { ok: false, message: `试验记录已经是「${target}」，不用重复操作` }
  }
  if (action === '判定合格' || action === '标记不合格') {
    if (String(record.status) !== '试验中') {
      return { ok: false, message: `已退回：记录当前为「${record.status}」，需先提交试验再判定` }
    }
  }

  record.status = target
  record.pending = false
  record.试验结论 = target
  record.判定人 = who.tester
  record.判定日期 = now()
  if (action === '标记不合格') {
    record.abnormal = true
    const deviceNo = syncPendingDevice(String(record.试验设备), String(record.试验编号))
    appendLog(
      record,
      `${tag()}判定试验不合格，记录封存只读；已同步保护装置台账待校验清单（装置编号：${deviceNo}）`,
    )
    persist(rows)
    return {
      ok: true,
      message: `试验记录 ${record.试验编号} 判定不合格，已转只读并列入保护装置台账待校验清单（${deviceNo}）`,
    }
  }

  appendLog(record, `${tag()}${action}，状态变更为「${target}」${target === '试验合格' ? '，整条封存只读' : ''}`)
  persist(rows)
  return { ok: true, message: `试验记录 ${record.试验编号} 已${action}，当前状态「${target}」` }
}

function validateSuccessor(teamKey: string, tester: string): string {
  if (!testersOf(teamKey).includes(tester)) {
    return '接班试验人不在所选班组花名册中'
  }
  return ''
}

// 单条移交：记录跟着接班试验人走（跨班组时归属班组同步变更）；原试验人作为历史保留不变。
export function handoverTest(id: number, teamKey: string, tester: string): ActionResult {
  const invalid = validateSuccessor(teamKey, tester)
  if (invalid) {
    return { ok: false, message: `退回：${invalid}` }
  }
  const who = actor()
  const rows = loadAll()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const record = rows[index]
  if (isConcluded(record)) {
    return { ok: false, message: `退回：记录 ${record.试验编号} 已判定${record.status}，历史记录不移交` }
  }
  if (record.试验人 === tester && record.teamKey === teamKey) {
    return { ok: false, message: '接班试验人与当前试验人相同，无需移交' }
  }

  const teamName = teamNameOf(teamKey)
  const crossTeam = record.teamKey !== teamKey
  const line = `${tag()}交接班移交：${record.试验人}（${record.所属班组}） → ${tester}（${teamName}）${crossTeam ? '，归属班组同步变更' : ''}`
  record.移交记录 = record.移交记录 ? `${record.移交记录}\n${line}` : line
  if (!record.原试验人) {
    record.原试验人 = String(record.试验人)
  }
  record.试验人 = tester
  record.teamKey = teamKey
  record.所属班组 = teamName
  appendLog(record, line)
  persist(rows)
  return { ok: true, message: `记录 ${record.试验编号} 已移交${tester}（${teamName}），原试验人 ${record.原试验人} 保留不变` }
}

// 整班交接：当前试验人名下所有「没出结论」的记录统一跟接班试验人走；已出结论的历史记录不动。
export function shiftHandover(teamKey: string, tester: string): ActionResult & { count: number } {
  const invalid = validateSuccessor(teamKey, tester)
  if (invalid) {
    return { ok: false, message: `退回：${invalid}`, count: 0 }
  }
  const who = actor()
  if (who.tester === tester && who.teamKey === teamKey) {
    return { ok: false, message: '接班试验人与当前试验人相同，无需交接', count: 0 }
  }
  const rows = loadAll()
  const teamName = teamNameOf(teamKey)
  let count = 0
  for (const record of rows) {
    if (isConcluded(record) || record.试验人 !== who.tester) {
      continue
    }
    const crossTeam = record.teamKey !== teamKey
    const line = `${tag()}交接班批量移交：${record.试验人}（${record.所属班组}） → ${tester}（${teamName}）${crossTeam ? '，归属班组同步变更' : ''}`
    record.移交记录 = record.移交记录 ? `${record.移交记录}\n${line}` : line
    if (!record.原试验人) {
      record.原试验人 = String(record.试验人)
    }
    record.试验人 = tester
    record.teamKey = teamKey
    record.所属班组 = teamName
    appendLog(record, line)
    count += 1
  }
  if (count === 0) {
    return { ok: false, message: `${who.tester} 名下没有未出结论的试验记录，无需交接`, count: 0 }
  }
  persist(rows)
  return {
    ok: true,
    count,
    message: `交接班完成：${count} 条未出结论记录已移交${tester}（${teamName}），历史记录中原试验人保持不变`,
  }
}
