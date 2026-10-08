<script setup lang="ts">
/** 配置头可视化编辑弹窗 -- 编辑器工具栏与文件树右键共用;确认后由父级写回文档 */
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteStore } from "@/stores/site";
import { ipc } from "@/ipc/ipc";
import { useUiStore } from "@/stores/ui";
import { assetRefPrefix } from "@/lib/paths";
import Modal from "./Modal.vue";
import AppIcon from "./AppIcon.vue";
import DateTimePicker from "./DateTimePicker.vue";
import SelectMenu from "./SelectMenu.vue";

export interface FrontMatterForm {
  title: string;
  description: string;
  date: string;
  cover: string;
  /** 作者署名;空 = 不显示 */
  author: string;
  /** AIGC 声明:空 = 不显示声明,none = 无任何 AIGC,present = 存在 AIGC */
  aigc: "" | "none" | "present";
  /** 隐藏文档:不进文章流/导航/搜索索引,仅可通过链接访问 */
  hidden: boolean;
  /** 页面目录(博客文章页):"" = 跟随主题设置,on = 强制显示,off = 强制隐藏 */
  toc: "" | "on" | "off";
  /** 博客主页专属:卡片流按分类分组(仅主页配置区展示) */
  homeGroups: boolean;
  /** 博客主页专属:分组时显示「未分类」组;缺省(勾选)= 显示 */
  homeShowUncategorized: boolean;
  /** 博客主页专属:「未分类」组的自定义标题;空 = 缺省「未分类」 */
  homeUncategorizedLabel: string;
}

const props = defineProps<{
  open: boolean;
  /** 目标文档的 content/ 相对路径,决定 asset 前缀换算与封面建议 */
  docPath: string;
  /** 打开时的预填值(通常来自文档现有配置头) */
  initial: FrontMatterForm;
  /** 是否为博客主页(根 index.md):true 时显示主页配置区 */
  blogHome?: boolean;
  /** 是否博客站点:true 时显示「页面目录」开关(仅博客文章页的目录可按文档覆盖) */
  blogSite?: boolean;
}>();

const emit = defineEmits<{
  confirm: [form: FrontMatterForm];
  cancel: [];
}>();

const { t } = useI18n();
const site = useSiteStore();
const ui = useUiStore();

const form = reactive<FrontMatterForm>({ title: "", description: "", date: "", cover: "", author: "", aigc: "", hidden: false, toc: "", homeGroups: false, homeShowUncategorized: true, homeUncategorizedLabel: "" });

/** AIGC 声明三档;选「不显示」时写回不落字段 */
const aigcOptions = computed(() => [
  { value: "", label: t("editor.aigcHidden") },
  { value: "none", label: t("editor.aigcNone") },
  { value: "present", label: t("editor.aigcPresent") },
]);

/** 页面目录三档;选「跟随主题设置」时写回不落字段 */
const tocOptions = computed(() => [
  { value: "", label: t("editor.fmTocFollow") },
  { value: "on", label: t("editor.fmTocShow") },
  { value: "off", label: t("editor.fmTocHide") },
]);

/** 确认:主页字段原样交由写回(隐藏未分类才落 false,标题留空 = 缺省「未分类」) */
function confirmForm() {
  emit("confirm", { ...form });
}

/** 打开时的表单快照:供空白区域关窗前判断是否有未保存改动 */
const openSnapshot = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      Object.assign(form, props.initial);
      openSnapshot.value = JSON.stringify({ ...form });
    }
  },
);

const hasChanges = () => JSON.stringify({ ...form }) !== openSnapshot.value;

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
  <Modal v-if="open" :title="t('editor.fmEditorTitle')" :width="400" :has-changes="hasChanges" :save-changes="confirmForm" @cancel="emit('cancel')">
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
        <span class="field-label">{{ t("editor.fmAuthor") }}</span>
        <input v-model="form.author" class="input" type="text" :placeholder="t('editor.fmAuthorPlaceholder')" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("editor.fmAigc") }}</span>
        <SelectMenu v-model="form.aigc" :options="aigcOptions" align="left" />
      </label>
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="checkbox-input"
          :checked="form.hidden"
          @change="form.hidden = ($event.target as HTMLInputElement).checked"
        />
        <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("editor.fmHidden") }}</span>
      </label>
      <p class="opt-hint">{{ t("editor.fmHiddenHint") }}</p>
      <!-- 页面目录(仅博客站点):三态覆盖,缺省跟随主题的「启用文章目录」 -->
      <template v-if="blogSite">
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("editor.fmToc") }}</span>
          <SelectMenu v-model="form.toc" :options="tocOptions" align="left" />
        </label>
        <p class="opt-hint">{{ t("editor.fmTocHint") }}</p>
      </template>
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

      <!-- 博客主页专属配置区:卡片流分类分组(仅根 index.md 显示) -->
      <template v-if="blogHome">
        <div class="my-1 border-t border-line" />
        <p class="field-label">{{ t("editor.fmHomeSection") }}</p>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="form.homeGroups"
            @change="form.homeGroups = ($event.target as HTMLInputElement).checked"
          />
          <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("editor.fmHomeGroups") }}</span>
        </label>
        <p class="opt-hint">{{ t("editor.fmHomeGroupsHint") }}</p>
        <template v-if="form.homeGroups">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="checkbox-input"
              :checked="form.homeShowUncategorized"
              @change="form.homeShowUncategorized = ($event.target as HTMLInputElement).checked"
            />
            <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("editor.fmHomeShowUncategorized") }}</span>
          </label>
          <p class="opt-hint">{{ t("editor.fmHomeShowUncategorizedHint") }}</p>
          <label class="flex flex-col gap-1">
            <span class="field-label">{{ t("editor.fmHomeUncategorizedLabel") }}</span>
            <input v-model="form.homeUncategorizedLabel" class="input" type="text" :placeholder="t('editor.fmHomeUncategorizedLabelPlaceholder')" />
          </label>
        </template>
      </template>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" @click="confirmForm">{{ t("common.save") }}</button>
    </template>
  </Modal>
</template>
