<script setup lang="ts">
/** 配置头可视化编辑弹窗 -- 编辑器工具栏与文件树右键共用;确认后由父级写回文档 */
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteStore } from "@/stores/site";
import { ipc } from "@/ipc/ipc";
import { useUiStore } from "@/stores/ui";
import { assetRefPrefix } from "@/lib/paths";
import Modal from "./Modal.vue";
import AppIcon from "./AppIcon.vue";
import DateTimePicker from "./DateTimePicker.vue";

export interface FrontMatterForm {
  title: string;
  description: string;
  date: string;
  cover: string;
}

const props = defineProps<{
  open: boolean;
  /** 目标文档的 content/ 相对路径,决定 asset 前缀换算与封面建议 */
  docPath: string;
  /** 打开时的预填值(通常来自文档现有配置头) */
  initial: FrontMatterForm;
}>();

const emit = defineEmits<{
  confirm: [form: FrontMatterForm];
  cancel: [];
}>();

const { t } = useI18n();
const site = useSiteStore();
const ui = useUiStore();

const form = reactive<FrontMatterForm>({ title: "", description: "", date: "", cover: "" });

watch(
  () => props.open,
  (open) => {
    if (open) Object.assign(form, props.initial);
  },
);

/** 当前文档位置引用站点资产的路径前缀(根级 asset/…,子目录 ../asset/…) */
const coverPrefix = computed(() => {
  const depth = props.docPath ? props.docPath.split("/").length - 1 : 0;
  return assetRefPrefix(depth);
});

/** 站点资产(asset,兼容旧 images)里的图,按目标文档位置换算为可直接使用的路径建议
 *  (子文件夹中的图片保留其相对层级) */
const coverSuggestions = computed(() =>
  site.assetFiles.map((n) => coverPrefix.value + n.path.slice(n.path.indexOf("/") + 1)),
);

/** 直接选取本地图片导入 asset,作为表单里的封面图 */
async function importCover() {
  try {
    const files = await ipc.pickImages();
    if (!files?.length) return;
    const names = await site.importSiteImages(files);
    if (names.length) form.cover = coverPrefix.value + names[0];
  } catch (e) {
    ui.toast(t("editor.imageImportFailed", { msg: ipc.errText(e) }), "error");
  }
}
</script>

<template>
  <Modal v-if="open" :title="t('editor.fmEditorTitle')" :width="400" @cancel="emit('cancel')">
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("editor.fmTitle") }}</span>
        <input v-model="form.title" class="input" type="text" :placeholder="t('editor.fmTitlePlaceholder')" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("editor.fmDescription") }}</span>
        <input v-model="form.description" class="input" type="text" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("editor.fmDate") }}</span>
        <DateTimePicker v-model="form.date" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("editor.fmCover") }}</span>
        <div class="flex gap-2">
          <input v-model="form.cover" class="input min-w-0 flex-1" type="text" list="fmCoverOptions" :placeholder="t('editor.fmCoverHint')" />
          <button type="button" class="btn btn-secondary shrink-0" @click="importCover">
            <AppIcon name="download" :size="14" />
            {{ t("editor.fmCoverImport") }}
          </button>
        </div>
        <datalist id="fmCoverOptions">
          <option v-for="s in coverSuggestions" :key="s" :value="s" />
        </datalist>
      </label>
      <p class="text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("editor.fmHint") }}</p>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" @click="emit('confirm', { ...form })">{{ t("common.save") }}</button>
    </template>
  </Modal>
</template>
