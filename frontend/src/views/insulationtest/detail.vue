<template>
  <section class="page detail-page" data-module="insulationtest-detail">
    <header class="page-head">
      <div>
        <h2>试验记录详情 {{ record?.试验编号 }}</h2>
        <p class="page-desc">
          归属{{ record?.所属班组 }} · 当前试验人 {{ record?.试验人 }}；试验电压、泄漏电流与试验设备仅归属班组试验人可改，判定后整条只读。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/insulationtest">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="!record" class="empty-state detail-empty">没有找到这条试验记录</div>

    <template v-else>
      <div v-if="concluded" class="notice notice-lock">
        本记录已于 {{ record.判定日期 }} 由 {{ record.判定人 }} 判定「{{ record.status }}」，整条转只读，任何班组不得再修改。
      </div>
      <div v-else-if="!owned" class="notice notice-other">
        本记录归属{{ record.所属班组 }}，当前身份为 {{ session.tester }}（{{ session.teamName }}），属跨班组访问：仅可查看，修改试验数据或执行流转将被退回并写明理由。
      </div>
      <div v-else class="notice notice-own">
        当前身份 {{ session.tester }}（{{ session.teamName }}）为归属班组试验人，可维护试验设备、试验电压与泄漏电流。
      </div>

      <div class="detail-grid">
        <article class="detail-card">
          <h3>试验信息</h3>
          <dl class="detail-fields">
            <dt>试验编号</dt><dd>{{ record.试验编号 }}</dd>
            <dt>所属班组</dt><dd>{{ record.所属班组 }}</dd>
            <dt>试验设备</dt>
            <dd>
              <input v-model="form.试验设备" class="detail-input" :disabled="!canEdit" />
            </dd>
            <dt>试验项目</dt><dd>{{ record.试验项目 || '—' }}</dd>
            <dt>试验电压</dt>
            <dd>
              <input v-model="form.试验电压" class="detail-input" :disabled="!canEdit" placeholder="沿用既有试验口径，如 10kV / 2500V" />
            </dd>
            <dt>泄漏电流</dt>
            <dd>
              <input v-model="form.泄漏电流" class="detail-input" :disabled="!canEdit" placeholder="如 20μA" />
              <span class="cell-note">与列表页同源同步</span>
            </dd>
            <dt>试验人</dt>
            <dd>
              {{ record.试验人 }}
              <span v-if="record.原试验人 && record.原试验人 !== record.试验人" class="cell-note">（历史原试验人：{{ record.原试验人 }}，保持不变）</span>
            </dd>
            <dt>原试验人</dt><dd>{{ record.原试验人 || '—' }}</dd>
            <dt>试验日期</dt><dd>{{ record.试验日期 }}</dd>
            <dt>当前状态</dt>
            <dd>
              {{ record.status }}
              <span v-if="concluded" class="lock-tag">只读</span>
              <span v-else-if="!owned" class="lock-tag other">他班</span>
            </dd>
            <dt>试验结论</dt><dd>{{ record.试验结论 || '尚未判定' }}</dd>
            <dt>判定人</dt><dd>{{ record.判定人 || '—' }}</dd>
            <dt>判定日期</dt><dd>{{ record.判定日期 || '—' }}</dd>
          </dl>
          <div class="detail-actions">
            <button class="btn primary" type="button" :disabled="!canEdit || !hasDiff" @click="saveFields">保存试验数据</button>
            <button
              v-for="action in availableActions"
              :key="action"
              class="btn"
              type="button"
              @click="runAction(action)"
            >
              {{ action }}
            </button>
            <button class="btn" type="button" :disabled="concluded" @click="openHandover">交接班移交</button>
          </div>
        </article>

        <article class="detail-card">
          <h3>交接班移交记录</h3>
          <pre v-if="record.移交记录" class="log-block">{{ record.移交记录 }}</pre>
          <p v-else class="cell-note">暂无移交，记录当前由 {{ record.试验人 }} 负责。</p>

          <h3 class="log-title">操作与修改留痕</h3>
          <pre v-if="record.修改日志" class="log-block">{{ record.修改日志 }}</pre>
          <p v-else class="cell-note">暂无留痕。</p>
        </article>
      </div>

      <footer class="page-foot">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="okMessage" class="ok-text">{{ okMessage }}</span>
      </footer>
    </template>

    <!-- 交接班移交 -->
    <div v-if="handoverVisible" class="modal-mask" @click.self="handoverVisible = false">
      <form class="modal-card" @submit.prevent="submitHandover">
        <h3>交接班移交 · {{ record!.试验编号 }}</h3>
        <p class="modal-hint">记录跟接班试验人走（跨班组时归属班组同步变更）；历史记录里原试验人 {{ record!.原试验人 }} 保持不变。</p>
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
import { useRoute } from 'vue-router'

import {
  canEditRecord,
  getInsulationTest,
  handoverTest,
  isRecordConcluded,
  runTestAction,
  updateTestFields,
  type EditableField,
  type InsulationRecord,
} from '@/api/insulation-service'
import { TEST_TEAMS, testersOf } from '@/data/org'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const session = useSessionStore()
const teams = TEST_TEAMS

const record = ref<InsulationRecord | undefined>()
const errorMessage = ref('')
const okMessage = ref('')

const form = reactive({ 试验设备: '', 试验电压: '', 泄漏电流: '' })

const concluded = computed(() => (record.value ? isRecordConcluded(record.value) : false))
const owned = computed(() => record.value?.teamKey === session.teamKey)
const canEdit = computed(() => (record.value ? canEditRecord(record.value) : false))
const availableActions = computed(() => {
  if (!record.value || concluded.value) {
    return []
  }
  if (record.value.status === '待试验') {
    return ['提交试验']
  }
  if (record.value.status === '试验中') {
    return ['判定合格', '标记不合格']
  }
  return []
})
const hasDiff = computed(() =>
  record.value
    ? form.试验设备 !== String(record.value.试验设备 ?? '') ||
      form.试验电压 !== String(record.value.试验电压 ?? '') ||
      form.泄漏电流 !== String(record.value.泄漏电流 ?? '')
    : false,
)

function flash(ok: boolean, message: string) {
  if (ok) {
    okMessage.value = message
    errorMessage.value = ''
  } else {
    errorMessage.value = message
    okMessage.value = ''
  }
}

function reload() {
  const id = Number(route.params.id)
  record.value = getInsulationTest(id)
  if (record.value) {
    form.试验设备 = String(record.value.试验设备 ?? '')
    form.试验电压 = String(record.value.试验电压 ?? '')
    form.泄漏电流 = String(record.value.泄漏电流 ?? '')
  }
}

function saveFields() {
  if (!record.value) {
    return
  }
  const patch: Partial<Record<EditableField, string>> = {
    试验设备: form.试验设备,
    试验电压: form.试验电压,
    泄漏电流: form.泄漏电流,
  }
  const result = updateTestFields(Number(record.value.id), patch)
  flash(result.ok, result.message)
  reload()
}

function runAction(action: string) {
  if (!record.value) {
    return
  }
  const result = runTestAction(Number(record.value.id), action)
  flash(result.ok, result.message)
  reload()
}

// ---- 移交 ----
const handoverVisible = ref(false)
const handoverError = ref('')
const handoverForm = reactive({ teamKey: session.teamKey, tester: '' })
const handoverTesters = computed(() => testersOf(handoverForm.teamKey))

function openHandover() {
  if (!record.value) {
    return
  }
  handoverForm.teamKey = record.value.teamKey
  handoverForm.tester = testersOf(record.value.teamKey).find((name) => name !== record.value?.试验人) ?? ''
  handoverError.value = ''
  handoverVisible.value = true
}

function onHandoverTeamChange() {
  handoverForm.tester = testersOf(handoverForm.teamKey)[0] ?? ''
}

function submitHandover() {
  if (!record.value) {
    return
  }
  const result = handoverTest(Number(record.value.id), handoverForm.teamKey, handoverForm.tester)
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
