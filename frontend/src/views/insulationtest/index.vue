<template>
  <section class="page" data-module="insulationtest">
    <header class="page-head">
      <div>
        <h2>绝缘试验管理</h2>
        <p class="page-desc">
          试验记录按班组归属：只有归属班组的试验人能改试验电压、泄漏电流与试验设备，跨班组修改一律退回并留痕；判定合格或不合格后整条转只读，其他班组仅可查看。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记试验记录</button>
        <button class="btn" type="button" @click="openShift">交接班移交</button>
        <button class="btn" type="button" @click="exportRows">导出绝缘试验清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <label class="filter-item">
        <span>当前班组</span>
        <select v-model="teamKey" @change="onTeamChange">
          <option v-for="team in teams" :key="team.key" :value="team.key">{{ team.name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>当前试验人</span>
        <select v-model="tester" @change="onTesterChange">
          <option v-for="name in teamTesters" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <span class="identity-tip">以「{{ tester }}（{{ teamLabel }}）」身份操作，跨班组改动会被退回并写明理由</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-mine">本班组归属：{{ ownedCount }} 条</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>试验编号</span>
        <input v-model="filters['试验编号']" placeholder="按试验编号检索" />
      </label>
      <label class="filter-item">
        <span>试验设备</span>
        <input v-model="filters['试验设备']" placeholder="按试验设备检索" />
      </label>
      <label class="filter-item">
        <span>所属班组</span>
        <input v-model="filters['所属班组']" placeholder="按所属班组检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>试验编号</th>
          <th>所属班组</th>
          <th>试验设备</th>
          <th>试验项目</th>
          <th>试验电压</th>
          <th>泄漏电流</th>
          <th>试验人</th>
          <th>试验日期</th>
          <th>试验结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-readonly': isConcluded(row), 'row-other': !isOwned(row) }">
          <td><RouterLink class="link" :to="`/insulationtest/${row.id}`">{{ row.试验编号 }}</RouterLink></td>
          <td>{{ row.所属班组 }}</td>
          <td>{{ row.试验设备 }}</td>
          <td>{{ row.试验项目 || '—' }}</td>
          <td>{{ row.试验电压 || '—' }}</td>
          <td>
            <input
              class="inline-input"
              :value="row.泄漏电流"
              :disabled="!canEdit(row)"
              :title="editHint(row)"
              @change="onLeakageChange(row, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>{{ row.试验人 }}<span v-if="row.原试验人 && row.原试验人 !== row.试验人" class="cell-note">（原：{{ row.原试验人 }}）</span></td>
          <td>{{ row.试验日期 }}</td>
          <td>{{ row.试验结论 || '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="isConcluded(row)" class="lock-tag">只读</span>
            <span v-else-if="!isOwned(row)" class="lock-tag other">他班</span>
          </td>
          <td class="row-actions">
            <template v-for="action in actionsFor(row)" :key="action">
              <button class="link" type="button" @click="runAction(action, row)">{{ action }}</button>
            </template>
            <button class="link" type="button" :disabled="isConcluded(row)" @click="openHandover(row)">移交</button>
            <RouterLink class="link" :to="`/insulationtest/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="11" class="empty-state">暂无绝缘试验数据，可先登记试验记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条绝缘试验记录 · 列表与详情共用同一数据源，泄漏电流两处同步</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>

    <!-- 登记试验记录 -->
    <div v-if="createVisible" class="modal-mask" @click.self="createVisible = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记试验记录</h3>
        <p class="modal-hint">归属班组：{{ teamLabel }}；登记试验人：{{ tester }}。同一台设备存在未出结论记录时重复提交将被退回。</p>
        <label class="form-item">
          <span>试验设备 *</span>
          <input v-model="createForm.试验设备" placeholder="如：110kV #1主变101开关间隔电流互感器" />
        </label>
        <label class="form-item">
          <span>试验项目</span>
          <input v-model="createForm.试验项目" placeholder="如：主绝缘交流耐压" />
        </label>
        <div class="form-grid">
          <label class="form-item">
            <span>试验电压</span>
            <input v-model="createForm.试验电压" placeholder="如：10kV" />
          </label>
          <label class="form-item">
            <span>泄漏电流</span>
            <input v-model="createForm.泄漏电流" placeholder="如：20μA" />
          </label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="createVisible = false">取消</button>
          <button class="btn primary" type="submit">提交登记</button>
        </div>
      </form>
    </div>

    <!-- 单条移交 / 整班交接 -->
    <div v-if="handoverVisible" class="modal-mask" @click.self="handoverVisible = false">
      <form class="modal-card" @submit.prevent="submitHandover">
        <h3>{{ handoverTarget ? '记录移交' : '交接班移交' }}</h3>
        <p class="modal-hint">
          <template v-if="handoverTarget">
            仅未出结论的记录可移交；记录 {{ handoverTarget.试验编号 }} 将跟接班试验人走，历史记录中原试验人保持不变。
          </template>
          <template v-else>
            当前试验人 {{ tester }} 名下所有「未出结论」的记录将整体移交；已出结论的历史记录不动。
          </template>
        </p>
        <label class="form-item">
          <span>接班班组</span>
          <select v-model="handoverForm.teamKey" @change="onHandoverTeamChange">
            <option v-for="team in teams" :key="team.key" :value="team.key">{{ team.name }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>接班试验人</span>
          <select v-model="handoverForm.tester">
            <option v-for="name in handoverTesters" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <p v-if="handoverError" class="error-text">{{ handoverError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="handoverVisible = false">取消</button>
          <button class="btn primary" type="submit">确认移交</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  canEditRecord,
  createInsulationTest,
  handoverTest,
  isRecordConcluded,
  listInsulationTests,
  runTestAction,
  shiftHandover,
  updateTestFields,
  type InsulationRecord,
} from '@/api/insulation-service'
import { TEST_TEAMS, teamNameOf, testersOf } from '@/data/org'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const teams = TEST_TEAMS

const rows = ref<InsulationRecord[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})

const teamKey = ref(session.teamKey)
const tester = ref(session.tester)
const teamLabel = computed(() => teamNameOf(teamKey.value))
const teamTesters = computed(() => testersOf(teamKey.value))

const stats = computed(() => [
  { label: '待试验设备', value: rows.value.filter((row) => row.status === '待试验').length },
  { label: '试验合格设备', value: rows.value.filter((row) => row.status === '试验合格').length },
  { label: '试验不合格设备', value: rows.value.filter((row) => row.status === '试验不合格').length },
])
const statusSummary = computed(() =>
  ['待试验', '试验中', '试验合格', '试验不合格'].map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)
const ownedCount = computed(() => rows.value.filter((row) => isOwned(row)).length)

function isOwned(row: InsulationRecord): boolean {
  return row.teamKey === session.teamKey
}
function isConcluded(row: InsulationRecord): boolean {
  return isRecordConcluded(row)
}
function canEdit(row: InsulationRecord): boolean {
  return canEditRecord(row)
}
function editHint(row: InsulationRecord): string {
  if (isConcluded(row)) {
    return '已判定，整条只读'
  }
  if (!isOwned(row)) {
    return `归属${row.所属班组}，本班组（${session.teamName}）仅可查看`
  }
  return '修改后回车或移出焦点即保存，详情页同步'
}

// 出结论前只能顺着待试验→试验中→判定走；按钮保留可见，越权点击会被服务退回并写明理由。
function actionsFor(row: InsulationRecord): string[] {
  if (row.status === '待试验') {
    return ['提交试验']
  }
  if (row.status === '试验中') {
    return ['判定合格', '标记不合格']
  }
  return []
}

function flash(ok: boolean, message: string) {
  if (ok) {
    okMessage.value = message
    errorMessage.value = ''
  } else {
    errorMessage.value = message
    okMessage.value = ''
  }
}

function onTeamChange() {
  const names = testersOf(teamKey.value)
  tester.value = names[0] ?? ''
  session.setIdentity(teamKey.value, tester.value)
  reload()
}

function onTesterChange() {
  session.setIdentity(teamKey.value, tester.value)
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('insulationtest')
}

function onLeakageChange(row: InsulationRecord, value: string) {
  const next = value.trim()
  if (next === String(row.泄漏电流 ?? '')) {
    return
  }
  const result = updateTestFields(Number(row.id), { 泄漏电流: next })
  flash(result.ok, result.message)
  reload()
}

function runAction(action: string, row: InsulationRecord) {
  const result = runTestAction(Number(row.id), action)
  flash(result.ok, result.message)
  reload()
}

function reload() {
  errorMessage.value = ''
  okMessage.value = ''
  const payload = listInsulationTests(filters.value)
  rows.value = payload.items as InsulationRecord[]
  total.value = payload.total
}

// ---- 登记 ----
const createVisible = ref(false)
const createError = ref('')
const createForm = reactive({ 试验设备: '', 试验项目: '', 试验电压: '', 泄漏电流: '' })

function openCreate() {
  createForm.试验设备 = ''
  createForm.试验项目 = ''
  createForm.试验电压 = ''
  createForm.泄漏电流 = ''
  createError.value = ''
  createVisible.value = true
}

function submitCreate() {
  const result = createInsulationTest({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createVisible.value = false
  flash(true, result.message)
  reload()
}

// ---- 移交 / 交接班 ----
const handoverVisible = ref(false)
const handoverError = ref('')
const handoverTarget = ref<InsulationRecord | null>(null)
const handoverForm = reactive({ teamKey: session.teamKey, tester: '' })
const handoverTesters = computed(() => testersOf(handoverForm.teamKey))

function openShift() {
  handoverTarget.value = null
  handoverForm.teamKey = session.teamKey
  handoverForm.tester = testersOf(session.teamKey).find((name) => name !== session.tester) ?? ''
  handoverError.value = ''
  handoverVisible.value = true
}

function openHandover(row: InsulationRecord) {
  if (isConcluded(row)) {
    flash(false, `已退回：记录 ${row.试验编号} 已判定${row.status}，历史记录不移交`)
    return
  }
  handoverTarget.value = row
  handoverForm.teamKey = row.teamKey
  handoverForm.tester = testersOf(row.teamKey).find((name) => name !== row.试验人) ?? ''
  handoverError.value = ''
  handoverVisible.value = true
}

function onHandoverTeamChange() {
  handoverForm.tester = testersOf(handoverForm.teamKey)[0] ?? ''
}

function submitHandover() {
  const result = handoverTarget.value
    ? handoverTest(Number(handoverTarget.value.id), handoverForm.teamKey, handoverForm.tester)
    : shiftHandover(handoverForm.teamKey, handoverForm.tester)
  if (!result.ok) {
    handoverError.value = result.message
    return
  }
  handoverVisible.value = false
  flash(true, result.message)
  reload()
}

onMounted(reload)
</script>
