<template>
  <section class="page detail-page" data-module="insulationtest-detail">
    <header class="page-head">
      <div>
        <h2>试验记录详情{{ row ? ` · ${row.试验编号}` : '' }}</h2>
        <p class="page-desc">
          归属「{{ row?.所属班组 ?? '—' }}」。列表与详情共用同一份数据，在此修改试验电压、泄漏电流与试验设备，列表页立即同步。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/insulationtest">返回试验列表</RouterLink>
      </div>
    </header>

    <IdentityBar />

    <div v-if="!row" class="empty-card">
      <p>没有找到这条试验记录，可能已被重置。</p>
      <RouterLink class="btn primary" to="/insulationtest">返回列表</RouterLink>
    </div>

    <template v-else>
      <div v-if="locked" class="banner banner-locked">
        该记录已于判定合格后整条转只读：试验电压、泄漏电流、试验设备及状态均不可再修改。
      </div>
      <div v-else-if="!owned" class="banner banner-view">
        跨班组只读：该记录归属「{{ row.所属班组 }}」，当前试验人属「{{ store.crew }}」，其他班组只能查看，改动将被退回并记录。
      </div>
      <div v-else-if="isOpen(row)" class="banner banner-owned">
        当前班组持有该记录，可修改试验电压、泄漏电流与试验设备。
      </div>
      <div v-else-if="failed" class="banner banner-failed">
        该记录已判定不合格，归属班组仍可补正试验数据；不合格结果已反映到保护装置台账的待校验清单。
      </div>

      <div class="detail-grid">
        <article class="detail-card">
          <h3>基础信息</h3>
          <dl>
            <div><dt>试验编号</dt><dd>{{ row.试验编号 }}</dd></div>
            <div><dt>当前状态</dt><dd>{{ row.status }}</dd></div>
            <div><dt>所属班组</dt><dd>{{ row.所属班组 }}</dd></div>
            <div><dt>试验人</dt><dd>{{ row.试验人 }}</dd></div>
            <div>
              <dt>历史试验人</dt>
              <dd>{{ row.历史试验人 || '—' }}<span class="muted-text">（交接班保留原值）</span></dd>
            </div>
            <div><dt>试验日期</dt><dd>{{ row.试验日期 }}</dd></div>
            <div><dt>试验项目</dt><dd>{{ row.试验项目 }}</dd></div>
            <div><dt>试验结论</dt><dd>{{ row.试验结论 || '未出结论' }}</dd></div>
          </dl>
        </article>

        <article class="detail-card">
          <h3>试验数据</h3>
          <p v-if="!canEdit" class="muted-text">
            {{ locked ? '合格记录只读' : owned ? '' : '非归属班组，仅可查看' }}
          </p>
          <div class="form-grid">
            <label class="form-item">
              <span>试验设备</span>
              <input v-model="edit.试验设备" :disabled="!canEdit" placeholder="同一设备未出结论前只允许一条" />
            </label>
            <label class="form-item">
              <span>试验电压</span>
              <input v-model="edit.试验电压" :disabled="!canEdit" placeholder="如：2.5kV" />
            </label>
            <label class="form-item">
              <span>泄漏电流</span>
              <input v-model="edit.泄漏电流" :disabled="!canEdit" placeholder="沿用既有试验口径，如：12μA" />
            </label>
          </div>
          <div v-if="canEdit" class="modal-actions">
            <button class="btn primary" type="button" @click="saveEdit">保存试验数据</button>
          </div>
          <p v-if="formMessage" :class="formOk ? 'ok-text' : 'error-text'">{{ formMessage }}</p>
        </article>
      </div>

      <article v-if="!locked" class="detail-card">
        <h3>状态流转</h3>
        <p class="muted-text">
          状态动作同样只接受归属班组试验人操作；判定合格后整条转只读，判定不合格将联动保护装置待校验清单。
        </p>
        <div class="row-actions">
          <button v-if="String(row.status) === '待试验'" class="btn" type="button" @click="doAction('提交试验')">
            提交试验
          </button>
          <button v-if="isOpen(row)" class="btn primary" type="button" @click="doAction('判定合格')">
            判定合格
          </button>
          <button v-if="isOpen(row)" class="btn btn-danger" type="button" @click="doAction('标记不合格')">
            标记不合格
          </button>
          <span v-if="failed" class="muted-text">已出不合格结论，不能重复判定</span>
        </div>
      </article>

      <article class="detail-card">
        <h3>操作留痕</h3>
        <ul v-if="logs.length" class="audit-list">
          <li v-for="(item, index) in logs" :key="index" :class="{ 'audit-rejected': item.rejected }">
            <div class="audit-head">
              <strong>{{ item.action }}</strong>
              <span>{{ item.at }}</span>
            </div>
            <div class="audit-who">{{ item.crew }} · {{ item.operator }}</div>
            <div v-if="item.detail" class="audit-detail">{{ item.detail }}</div>
            <div v-if="item.rejected && item.reason" class="audit-reason">退回理由：{{ item.reason }}</div>
          </li>
        </ul>
        <p v-else class="muted-text">暂无操作留痕</p>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  checkWritable,
  getInsulation,
  isOpen,
  judgeInsulation,
  readAudit,
  submitInsulation,
  updateInsulationFields,
  type Identity,
} from '@/api/insulation-service'
import IdentityBar from '@/components/IdentityBar.vue'
import type { AuditEntry, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useSessionStore()

const row = ref<EntryRow | undefined>(getInsulation(Number(route.params.id)))
const logs = ref<AuditEntry[]>(row.value ? readAudit(row.value) : [])

const identity = computed<Identity>(() => ({ operator: store.operator, crew: store.crew }))
const locked = computed(() => row.value?.status === '试验合格')
const failed = computed(() => row.value?.status === '试验不合格')
const owned = computed(() => !!row.value && String(row.value.所属班组) === store.crew)
const canEdit = computed(
  () => !!row.value && !locked.value && owned.value && String(checkWritable(row.value, identity.value).ok),
)

const edit = reactive({ 试验设备: '', 试验电压: '', 泄漏电流: '' })
const formMessage = ref('')
const formOk = ref(false)

function syncEdit() {
  if (!row.value) {
    return
  }
  edit.试验设备 = String(row.value.试验设备 ?? '')
  edit.试验电压 = String(row.value.试验电压 ?? '')
  edit.泄漏电流 = String(row.value.泄漏电流 ?? '')
}
syncEdit()

function reload() {
  row.value = getInsulation(Number(route.params.id))
  logs.value = row.value ? readAudit(row.value) : []
  syncEdit()
}

// 切换身份后页面上的可编辑性要立即重算
watch(
  () => [store.operator, store.crew],
  () => reload(),
)

function saveEdit() {
  formMessage.value = ''
  if (!row.value) {
    return
  }
  const result = updateInsulationFields(
    Number(row.value.id),
    { 试验设备: edit.试验设备, 试验电压: edit.试验电压, 泄漏电流: edit.泄漏电流 },
    identity.value,
  )
  formOk.value = result.ok
  formMessage.value = result.message
  reload()
}

function doAction(action: '提交试验' | '判定合格' | '标记不合格') {
  formMessage.value = ''
  if (!row.value) {
    return
  }
  const id = Number(row.value.id)
  let result
  if (action === '提交试验') {
    result = submitInsulation(id, identity.value)
  } else if (action === '判定合格') {
    result = judgeInsulation(id, '合格', identity.value)
  } else {
    result = judgeInsulation(id, '不合格', identity.value)
  }
  formOk.value = result.ok
  formMessage.value = result.message
  reload()
}
</script>
