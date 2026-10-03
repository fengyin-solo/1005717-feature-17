<template>
  <div class="identity-bar">
    <span class="identity-title">当前试验人</span>
    <select v-model="selectedCrew" class="identity-select" aria-label="选择班组">
      <option v-for="crew in crews" :key="crew" :value="crew">{{ crew }}</option>
    </select>
    <select v-model="selectedTester" class="identity-select" aria-label="选择试验人">
      <option v-for="tester in testersOfCrew" :key="tester" :value="tester">{{ tester }}</option>
    </select>
    <button class="btn primary btn-sm" type="button" @click="applyIdentity">切换身份</button>
    <span class="identity-hint">归属班组 = {{ store.crew }}，切换后其他班组记录只能查看</span>
    <button class="btn btn-sm" type="button" @click="emit('handover')">交接班</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { CREW_TESTERS, CREWS } from '@/data/roster'
import { useSessionStore } from '@/stores/session'

const emit = defineEmits<{ handover: [] }>()

const store = useSessionStore()
const crews = CREWS
const selectedCrew = ref(store.crew)
const selectedTester = ref(store.operator)

const testersOfCrew = computed(() => CREW_TESTERS[selectedCrew.value] ?? [])

function applyIdentity() {
  store.setIdentity(selectedTester.value, selectedCrew.value)
}

// 交接班等动作会直接改会话身份，下拉框跟着同步，避免显示与实际归属不一致
watch(
  () => [store.crew, store.operator],
  ([crew, operator]) => {
    selectedCrew.value = String(crew)
    selectedTester.value = String(operator)
  },
)

// 班组切换后若原试验人不在新班组，自动落到新班组第一人
watch(selectedCrew, (crew) => {
  if (!(CREW_TESTERS[crew] ?? []).includes(selectedTester.value)) {
    selectedTester.value = (CREW_TESTERS[crew] ?? [''])[0]
  }
})
</script>
