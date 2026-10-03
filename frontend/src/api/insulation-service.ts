import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import { crewOfTester } from '@/data/roster'
import type { ActionResult, AuditEntry, EntryRow, PageResult } from '@/data/types'

/**
 * 绝缘试验专属业务规则（不经过通用 runAction）：
 * - 记录挂归属班组，仅归属班组的试验人能改试验电压、泄漏电流、试验设备；跨班组改一律退回并写明理由；
 * - 判定合格后整条转只读，任何修改（含状态动作）都拒绝；
 * - 交接班只带走「没出结论」的记录，试验人/归属跟着新试验人走，历史记录中原试验人保留不变；
 * - 判定不合格联动到保护装置台账的待校验清单（同设备只维护一条）；
 * - 同一台设备同时只允许一条未出结论的试验记录，重复提交只落一条。
 */

export const INSULATION_KEY = 'insulationtest'
export const PROTECTION_KEY = 'protectiondevice'

export const OPEN_STATUSES = ['待试验', '试验中']
export const CONCLUDED_STATUSES = ['试验合格', '试验不合格']
export const LOCKED_STATUS = '试验合格'

const EDITABLE_FIELDS = ['试验设备', '试验电压', '泄漏电流'] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]
export type InsulationPatch = Partial<Record<EditableField, string>>

export type Identity = {
  operator: string
  crew: string
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function readAudit(row: EntryRow): AuditEntry[] {
  const logs = row.操作日志
  return Array.isArray(logs) ? (logs as AuditEntry[]) : []
}

function withAudit(row: EntryRow, entry: AuditEntry): EntryRow {
  return { ...row, 操作日志: [...readAudit(row), entry] }
}

function audit(
  identity: Identity,
  action: string,
  detail?: string,
  extra?: { rejected?: boolean; reason?: string },
): AuditEntry {
  return {
    at: now(),
    operator: identity.operator,
    crew: identity.crew,
    action,
    detail,
    rejected: extra?.rejected,
    reason: extra?.reason,
  }
}

// 把越权/只读退回也落进该记录的操作日志，事后能查出是谁、在哪个班组尝试动过。
function persistRejection(id: number, identity: Identity, action: string, reason: string): void {
  const rows = listRows(INSULATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return
  }
  const next = [...rows]
  next[index] = withAudit(rows[index], audit(identity, action, undefined, { rejected: true, reason }))
  saveRows(INSULATION_KEY, next)
}

/** 归属与只读闸门：view 不拦，所有写操作先过这里。 */
export function checkWritable(row: EntryRow, identity: Identity): ActionResult {
  if (String(row.status) === LOCKED_STATUS) {
    return { ok: false, message: `记录 ${row.试验编号} 已判定合格，整条只读，不能再修改` }
  }
  if (String(row.所属班组) !== identity.crew) {
    return {
      ok: false,
      message: `跨班组退回：记录 ${row.试验编号} 归属「${row.所属班组}」，当前试验人属「${identity.crew}」，仅归属班组的试验人可改动试验电压、泄漏电流与试验设备`,
    }
  }
  return { ok: true, message: '' }
}

export function isOpen(row: EntryRow): boolean {
  return OPEN_STATUSES.includes(String(row.status))
}

export function listInsulation(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(INSULATION_KEY), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getInsulation(id: number): EntryRow | undefined {
  return listRows(INSULATION_KEY).find((row) => Number(row.id) === id)
}

function findOpenByDevice(rows: EntryRow[], device: string, excludeId?: number): EntryRow | undefined {
  return rows.find(
    (row) =>
      Number(row.id) !== excludeId &&
      String(row.试验设备).trim() === device.trim() &&
      isOpen(row),
  )
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function nextTestCode(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const m = /(\d+)\s*$/.exec(String(row.试验编号 ?? ''))
    if (m) {
      max = Math.max(max, Number(m[1]))
    }
  }
  return `INSU-${String(max + 1).padStart(4, '0')}`
}

export type InsulationDraft = {
  试验设备: string
  试验项目: string
  试验电压: string
  泄漏电流: string
  试验日期: string
}

/** 登记试验记录：同一台设备已有未出结论记录时直接退回，不允许落第二条。 */
export function createInsulation(draft: InsulationDraft, identity: Identity): ActionResult {
  const device = draft.试验设备.trim()
  if (!device) {
    return { ok: false, message: '试验设备不能为空' }
  }
  if (!draft.试验项目.trim()) {
    return { ok: false, message: '试验项目不能为空' }
  }
  const rows = listRows(INSULATION_KEY)
  const duplicate = findOpenByDevice(rows, device)
  if (duplicate) {
    return {
      ok: false,
      message: `同一台设备已存在未出结论的试验记录 ${duplicate.试验编号}（${duplicate.status}，归属${duplicate.所属班组}），重复提交不再落新记录，请在原记录上继续试验`,
    }
  }
  const code = nextTestCode(rows)
  const row: EntryRow = {
    id: nextId(rows),
    status: '待试验',
    pending: true,
    abnormal: false,
    试验编号: code,
    试验设备: device,
    试验项目: draft.试验项目.trim(),
    试验电压: draft.试验电压.trim(),
    泄漏电流: draft.泄漏电流.trim(),
    所属班组: identity.crew,
    试验人: identity.operator,
    历史试验人: '',
    试验日期: draft.试验日期 || now().slice(0, 10),
    试验结论: '',
  }
  const saved = withAudit(
    row,
    audit(identity, '登记试验记录', `新建 ${code}，归属${identity.crew}`),
  )
  saveRows(INSULATION_KEY, [...rows, saved])
  return { ok: true, message: `试验记录 ${code} 已登记，归属${identity.crew}` }
}

/**
 * 修改受控字段（仅试验电压、泄漏电流、试验设备三项）。
 * 列表页与详情页共用这一处写入口，两处读到的泄漏电流天然是同一份。
 */
export function updateInsulationFields(
  id: number,
  patch: InsulationPatch,
  identity: Identity,
): ActionResult {
  const rows = listRows(INSULATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const current = rows[index]
  const gate = checkWritable(current, identity)
  if (!gate.ok) {
    persistRejection(id, identity, '修改试验数据', gate.message)
    return gate
  }

  const changes: string[] = []
  const updated: EntryRow = { ...current }
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) {
      continue
    }
    const next = String(patch[field] ?? '').trim()
    if (!next) {
      return { ok: false, message: `${field}不能为空` }
    }
    if (String(current[field] ?? '') !== next) {
      changes.push(`${field}：${current[field] || '空'} → ${next}`)
    }
    updated[field] = next
  }
  if (String(updated.试验设备) !== String(current.试验设备)) {
    const duplicate = findOpenByDevice(rows, String(updated.试验设备), id)
    if (duplicate) {
      return {
        ok: false,
        message: `改后的试验设备与未结记录 ${duplicate.试验编号} 冲突，同一台设备只能有一条未出结论的试验`,
      }
    }
  }
  if (!changes.length) {
    return { ok: true, message: '内容没有变化' }
  }

  const next = [...rows]
  next[index] = withAudit(
    updated,
    audit(identity, '修改试验数据', changes.join('；')),
  )
  saveRows(INSULATION_KEY, next)
  return { ok: true, message: `记录 ${current.试验编号} 已更新：${changes.join('；')}` }
}

/** 提交试验：待试验 → 试验中。 */
export function submitInsulation(id: number, identity: Identity): ActionResult {
  const rows = listRows(INSULATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const current = rows[index]
  const gate = checkWritable(current, identity)
  if (!gate.ok) {
    persistRejection(id, identity, '提交试验', gate.message)
    return gate
  }
  if (String(current.status) === '试验中') {
    return { ok: false, message: `记录 ${current.试验编号} 已在试验中，不用重复提交` }
  }
  if (String(current.status) !== '待试验') {
    return { ok: false, message: `记录 ${current.试验编号} 当前为「${current.status}」，不能再提交试验` }
  }
  const next = [...rows]
  next[index] = withAudit(
    { ...current, status: '试验中', pending: true, abnormal: false },
    audit(identity, '提交试验', '待试验 → 试验中'),
  )
  saveRows(INSULATION_KEY, next)
  return { ok: true, message: `记录 ${current.试验编号} 已提交，进入试验中` }
}

/** 判定合格 / 不合格；合格即整条只读，不合格联动保护装置待校验清单。 */
export function judgeInsulation(
  id: number,
  verdict: '合格' | '不合格',
  identity: Identity,
): ActionResult {
  const rows = listRows(INSULATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const current = rows[index]
  const action = verdict === '合格' ? '判定合格' : '标记不合格'
  const gate = checkWritable(current, identity)
  if (!gate.ok) {
    persistRejection(id, identity, action, gate.message)
    return gate
  }
  if (!isOpen(current)) {
    return { ok: false, message: `记录 ${current.试验编号} 已出结论「${current.status}」，不能重复判定` }
  }
  if (!String(current.试验电压).trim() || !String(current.泄漏电流).trim()) {
    return { ok: false, message: '试验电压与泄漏电流未填全，不能判定，请由归属班组试验人补录后再判定' }
  }

  const passed = verdict === '合格'
  const target = passed ? '试验合格' : '试验不合格'
  let updated: EntryRow = {
    ...current,
    status: target,
    pending: false,
    abnormal: !passed,
    试验结论: verdict,
  }
  updated = withAudit(
    updated,
    audit(
      identity,
      action,
      passed ? `${current.status} → 试验合格，记录整条转只读` : `${current.status} → 试验不合格`,
    ),
  )
  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows(INSULATION_KEY, nextRows)

  if (!passed) {
    reflectToProtection(String(current.试验设备), String(current.试验编号))
    return {
      ok: true,
      message: `记录 ${current.试验编号} 已标记不合格，结果已反映到保护装置台账的待校验清单`,
    }
  }
  return { ok: true, message: `记录 ${current.试验编号} 已判定合格，整条转只读` }
}

/**
 * 不合格结果反映到保护装置台账：
 * 按装置编号 / 所属间隔匹配同一台设备，命中就翻到「待校验」；
 * 命不中就新增一条待校验装置。同一设备反复不合格只维护同一条，不堆重复数据。
 */
function reflectToProtection(device: string, sourceCode: string): void {
  const rows = listRows(PROTECTION_KEY)
  const note = `绝缘试验 ${sourceCode} 判定不合格`
  const index = rows.findIndex(
    (row) => String(row.装置编号).trim() === device.trim() || String(row.所属间隔).trim() === device.trim(),
  )
  if (index >= 0) {
    if (String(rows[index].status) === '待校验') {
      const next = [...rows]
      next[index] = { ...rows[index], 来源: note }
      saveRows(PROTECTION_KEY, next)
      return
    }
    const next = [...rows]
    next[index] = {
      ...rows[index],
      status: '待校验',
      pending: true,
      装置状态: '待校验',
      来源: note,
    }
    saveRows(PROTECTION_KEY, next)
    return
  }
  const created: EntryRow = {
    id: nextId(rows),
    status: '待校验',
    pending: true,
    abnormal: false,
    装置编号: device,
    所属间隔: device,
    装置型号: '—',
    保护类型: '—',
    投运日期: '',
    校验周期: '—',
    上次校验日: '',
    装置状态: '待校验',
    来源: note,
  }
  saveRows(PROTECTION_KEY, [...rows, created])
}

export type HandoverResult = ActionResult & { moved?: number; untouched?: number }

/**
 * 交接班：当前试验人名下「没出结论」的记录整体移交给新试验人，
 * 归属班组随新试验人所在班组走；原试验人写入历史试验人并保留在操作日志里。
 * 已出结论的记录一律不带动，历史记录里的试验人保持原值。
 */
export function handoverOpenRecords(newTester: string, identity: Identity): HandoverResult {
  const target = newTester.trim()
  const newCrew = crewOfTester(target)
  if (!target) {
    return { ok: false, message: '请选择接班的新试验人' }
  }
  if (!newCrew) {
    return { ok: false, message: `试验人 ${target} 不在班组花名册里，不能交接` }
  }
  if (target === identity.operator) {
    return { ok: false, message: '接班试验人与当前试验人相同，无需交接' }
  }

  const rows = listRows(INSULATION_KEY)
  let moved = 0
  let untouched = 0
  const next = rows.map((row) => {
    if (String(row.试验人) !== identity.operator) {
      return row
    }
    if (!isOpen(row)) {
      untouched += 1
      return row
    }
    moved += 1
    const history = String(row.历史试验人 ?? '')
      .split('、')
      .map((name) => name.trim())
      .filter(Boolean)
    if (!history.includes(identity.operator)) {
      history.push(identity.operator)
    }
    return withAudit(
      {
        ...row,
        试验人: target,
        所属班组: newCrew,
        历史试验人: history.join('、'),
      },
      audit(
        identity,
        '交接班移交',
        `未出结论，移交 ${newCrew}/${target} 接手；原试验人 ${identity.operator} 保留在历史记录`,
      ),
    )
  })

  if (moved === 0) {
    return {
      ok: false,
      message: `当前试验人 ${identity.operator} 名下没有未出结论的记录需要交接${untouched ? `，${untouched} 条已出结论记录保持原试验人不变` : ''}`,
      untouched,
    }
  }
  saveRows(INSULATION_KEY, next)
  return {
    ok: true,
    moved,
    untouched,
    message: `已将 ${moved}  条未出结论记录移交 ${newCrew}/${target}${untouched ? `；${untouched} 条已出结论记录原试验人不变` : ''}`,
  }
}
