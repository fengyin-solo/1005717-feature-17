<template>
  <section class="page" data-module="insulationtest">
    <header class="page-head">
      <div>
        <h2>绝缘试验管理</h2>
        <p class="page-desc">
          试验记录挂归属班组：仅归属班组的试验人可改试验电压、泄漏电流与试验设备，跨班组改动一律退回；判定合格后整条只读。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记试验记录</button>
        <button class="btn" type="button" @click="exportRows">导出绝缘试验清单</button>
      </div>
    </header>

    <IdentityBar @handover="openHandover" />

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
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>当前状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>归属与可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-locked': isLocked(row), 'row-other': !owned(row) }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '试验编号'">
              <RouterLink class="link" :to="`/insulationtest/${row.id}`">{{ row[column] }}</RouterLink>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            {{ row.status }}
            <span v-if="isLocked(row)" class="tag tag-locked" title="判定合格后整条只读">已锁定</span>
            <span v-else-if="!owned(row)" class="tag tag-view" title="其他班组只能查看">只读/他班</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/insulationtest/${row.id}`">
              {{ owned(row) && canEdit(row) ? '详情/修改' : '查看详情' }}
            </RouterLink>
            <template v-if="!isLocked(row)">
              <button
                v-if="String(row.status) === '待试验'"
                class="link"
                type="button"
                @click="runAction('提交试验', row)"
              >
                提交试验
              </button>
              <button
                v-if="isOpen(row)"
                class="link"
                type="button"
                @click="runAction('判定合格', row)"
              >
                判定合格
              </button>
              <button
                v-if="isOpen(row)"
                class="link link-danger"
                type="button"
                @click="runAction('标记不合格', row)"
              >
                标记不合格
              </button>
            </template>
            <span v-else class="muted-text">合格记录只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无绝缘试验数据，可先登记试验记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条绝缘试验记录（归属{{ store.crew }}，试验人 {{ store.operator }}）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="notice" class="ok-text">{{ notice }}</span>
    </footer>

    <!-- 登记 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记试验记录</h3>
        <p class="modal-sub">记录自动归属当前班组「{{ store.crew }}」，试验人 {{ store.operator }}。同一台设备未出结论前只允许一条。</p>
        <div class="form-grid">
          <label class="form-item">
            <span>试验设备 *</span>
            <input v-model="draft.试验设备" placeholder="如：110kV母联间隔断路器" />
          </label>
          <label class="form-item">
            <span>试验项目 *</span>
            <input v-model="draft.试验项目" placeholder="如：主绝缘电阻及泄漏电流" />
          </label>
          <label class="form-item">
            <span>试验电压</span>
            <input v-model="draft.试验电压" placeholder="如：2.5kV（可试验前留空，后补）" />
          </label>
          <label class="form-item">
            <span>泄漏电流</span>
            <input v-model="draft.泄漏电流" placeholder="沿用既有口径，如：12μA" />
          </label>
          <label class="form-item">
            <span>试验日期</span>
            <input v-model="draft.试验日期" type="date" />
          </label>
        </div>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 交接班 -->
    <div v-if="handoverOpen" class="modal-mask" @click.self="closeHandover">
      <div class="modal">
        <h3>交接班</h3>
        <p class="modal-sub">
          当前试验人 {{ store.operator }}（{{ store.crew }}）名下未出结论的记录将随新试验人走；已出结论记录的原试验人保持不变。
        </p>
        <label class="form-item">
          <span>接班试验人 *</span>
          <select v-model="handoverTester">
            <option value="">请选择接班试验人</option>
            <optgroup v-for="(testers, crew) in CREW_TESTERS" :key="crew" :label="crew">
              <option v-for="tester in testers" :key="tester" :value="tester" :disabled="tester === store.operator">
                {{ tester }}（{{ crew }}）
              </option>
            </optgroup>
          </select>
        </label>
        <p v-if="handoverTester" class="modal-sub">
          交接后归属班组变为「{{ newCrew }}」，由 {{ handoverTester }} 接手并可修改试验数据。
        </p>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeHandover">取消</button>
          <button class="btn primary" type="button" @click="submitHandover">确认交接</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createInsulation,
  handoverOpenRecords,
  isOpen as isOpenRow,
  judgeInsulation,
  listInsulation,
  submitInsulation,
} from '@/api/insulation-service'
import { downloadEntries } from '@/api/local-service'
import IdentityBar from '@/components/IdentityBar.vue'
import { CREW_TESTERS, crewOfTester } from '@/data/roster'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const columns = ['试验编号', '试验设备', '试验项目', '试验电压', '泄漏电流', '所属班组', '试验人', '试验日期', '试验结论']
const statuses = ['待试验', '试验中', '试验合格', '试验不合格']
const filterFields = ['试验编号', '试验设备', '试验项目', '所属班组']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})

const isOpen = (row: EntryRow) => isOpenRow(row)
const isLocked = (row: EntryRow) => String(row.status) === '试验合格'
const owned = (row: EntryRow) => String(row.所属班组) === store.crew
const canEdit = (row: EntryRow) => owned(row) && !isLocked(row)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待试验设备', value: rows.value.filter((row) => row.status === '待试验').length },
  { label: '试验合格设备', value: rows.value.filter((row) => row.status === '试验合格').length },
  { label: '试验不合格设备', value: rows.value.filter((row) => row.status === '试验不合格').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('insulationtest')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const identity = { operator: store.operator, crew: store.crew }
  let result
  if (action === '提交试验') {
    result = submitInsulation(Number(row.id), identity)
  } else if (action === '判定合格') {
    result = judgeInsulation(Number(row.id), '合格', identity)
  } else if (action === '标记不合格') {
    result = judgeInsulation(Number(row.id), '不合格', identity)
  } else {
    result = { ok: false, message: `未登记动作「${action}」` }
  }
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    notice.value = result.message
  }
  reload()
}

function reload() {
  const applied: Record<string, string> = { ...filters.value }
  const status = applied.status
  delete applied.status
  const payload = listInsulation(applied)
  let items = payload.items
  if (status) {
    items = items.filter((row) => String(row.status) === status)
  }
  rows.value = items
  total.value = items.length
}

// 登记弹窗
const createOpen = ref(false)
const modalError = ref('')
const emptyDraft = () => ({
  试验设备: '',
  试验项目: '',
  试验电压: '',
  泄漏电流: '',
  试验日期: new Date().toISOString().slice(0, 10),
})
const draft = reactive(emptyDraft())

function openCreate() {
  modalError.value = ''
  createOpen.value = true
}
function closeCreate() {
  createOpen.value = false
}
function submitCreate() {
  modalError.value = ''
  const result = createInsulation({ ...draft }, { operator: store.operator, crew: store.crew })
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  notice.value = result.message
  Object.assign(draft, emptyDraft())
  createOpen.value = false
  reload()
}

// 交接班弹窗
const handoverOpen = ref(false)
const handoverTester = ref('')
const newCrew = computed(() => crewOfTester(handoverTester.value))

function openHandover() {
  modalError.value = ''
  handoverTester.value = ''
  handoverOpen.value = true
}
function closeHandover() {
  handoverOpen.value = false
}
function submitHandover() {
  modalError.value = ''
  const result = handoverOpenRecords(handoverTester.value, {
    operator: store.operator,
    crew: store.crew,
  })
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  // 记录跟着新试验人走，当前工作台也切到接班人身份继续作业
  store.setIdentity(handoverTester.value, newCrew.value)
  notice.value = result.message
  handoverOpen.value = false
  reload()
}

onMounted(reload)
</script>
