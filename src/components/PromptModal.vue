<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Modal from "./Modal.vue";

const props = defineProps<{
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  /** 可选第二输入框(如博客新文档的副标题);不传则不显示 */
  extraLabel?: string;
  extraPlaceholder?: string;
  confirmText?: string;
}>();

const emit = defineEmits<{ confirm: [value: string, extra: string]; cancel: [] }>();
const { t } = useI18n();
const value = ref("");
const extraValue = ref("");
const inputRef = ref<HTMLInputElement>();
/** 打开时的初始值:供空白区域关窗前判断是否有未保存改动 */
const initialValue = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      value.value = props.initial ?? "";
      extraValue.value = "";
      initialValue.value = props.initial ?? "";
      // autofocus 在 Teleport 弹层中不可靠,显式聚焦
      void nextTick(() => inputRef.value?.focus());
    }
  },
);

function submit() {
  const v = value.value.trim();
  if (v) emit("confirm", v, extraValue.value.trim());
}

/** 有改动 = 主输入偏离初始值,或第二输入框填了内容;主输入被清空视为放弃,不拦关窗 */
const hasChanges = () =>
  value.value.trim() !== initialValue.value.trim() ||
  (!!props.extraLabel && extraValue.value.trim() !== "");

/** 空白关窗询问中的「保存」:与确认按钮同义;输入为空(无效)时保持窗口打开 */
const saveChanges = () => {
  if (!value.value.trim()) return false;
  submit();
};
</script>

<template>
  <Modal
    v-if="open"
    :title="title"
    :width="380"
    :has-changes="hasChanges"
    :save-changes="saveChanges"
    :save-text="confirmText ?? t('common.confirm')"
    @cancel="emit('cancel')"
  >
    <label v-if="label" class="field-label">{{ label }}</label>
    <input
      ref="inputRef"
      v-model="value"
      class="input"
      type="text"
      :placeholder="placeholder ?? ''"
      autofocus
      @keydown.enter="submit"
      @keydown.esc="emit('cancel')"
    />
    <template v-if="extraLabel">
      <label class="field-label mt-3">{{ extraLabel }}</label>
      <input
        v-model="extraValue"
        class="input"
        type="text"
        :placeholder="extraPlaceholder ?? ''"
        @keydown.enter="submit"
        @keydown.esc="emit('cancel')"
      />
    </template>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" :disabled="!value.trim()" @click="submit">
        {{ confirmText ?? t("common.confirm") }}
      </button>
    </template>
  </Modal>
</template>
