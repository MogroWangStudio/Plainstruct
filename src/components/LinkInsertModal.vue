<script setup lang="ts">
/** 插入链接弹窗:链接地址、显示文本与「在新窗口打开」;
 *  新窗口打开以 kramdown 风格属性块写入(渲染为 target="_blank" + noopener) */
import { reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import Modal from "./Modal.vue";

export interface LinkInsertResult {
  url: string;
  text: string;
  blank: boolean;
}

const props = defineProps<{ open: boolean; initialText: string }>();
const emit = defineEmits<{ confirm: [result: LinkInsertResult]; cancel: [] }>();

const { t } = useI18n();

const state = reactive({ url: "", text: "", blank: false });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    state.url = "https://";
    state.text = props.initialText;
    state.blank = false;
  },
);

/** URL 需非空(不为占位协议);文本可空(确认时回退占位) */
const valid = () => !!state.url.trim() && state.url.trim() !== "https://";

function confirm() {
  if (!valid()) return;
  emit("confirm", { url: state.url.trim(), text: state.text.trim(), blank: state.blank });
}
</script>

<template>
  <Modal v-if="open" :title="t('linkInsert.title')" :width="400" @cancel="emit('cancel')">
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("linkInsert.url") }}</span>
        <input v-model="state.url" class="input mono" type="text" spellcheck="false" placeholder="https://example.com" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("linkInsert.text") }}</span>
        <input v-model="state.text" class="input" type="text" :placeholder="t('linkInsert.textPlaceholder')" />
      </label>
      <div>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="state.blank"
            @change="state.blank = ($event.target as HTMLInputElement).checked"
          />
          <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("linkInsert.blank") }}</span>
        </label>
        <p class="opt-hint">{{ t("linkInsert.blankHint") }}</p>
      </div>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" :disabled="!valid()" @click="confirm">{{ t("linkInsert.insert") }}</button>
    </template>
  </Modal>
</template>
