<script setup lang="ts">
/** 新建文档弹窗:文档名称与配置头(标题/描述/日期/封面/作者/AIGC)一次填好,创建时一并写入 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ipc } from "@/ipc/ipc";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import { assetRefPrefix } from "@/lib/paths";
import { parseFrontMatter, type AigcDeclaration } from "@/lib/frontmatter";
import { useBackdropClose } from "@/lib/backdrop-close";
import AppIcon from "@/components/AppIcon.vue";
import DateTimePicker from "@/components/DateTimePicker.vue";
import SelectMenu from "@/components/SelectMenu.vue";

const props = defineProps<{ open: boolean; dir: string }>();
const emit = defineEmits<{
  confirm: [payload: {
    name: string;
    title: string;
    description: string;
    date: string;
    cover: string;
    author: string;
    aigc: "" | AigcDeclaration;
    /** 隐藏文档:勾选后不进文章流/导航/搜索索引 */
    hidden: boolean;
    /** 页面目录(博客):on = 强制显示,"" = 不落字段跟随主题设置 */
    toc: "" | "on";
  }];
  cancel: [];
}>();

const { t } = useI18n();
const site = useSiteStore();
const theme = useThemeStore();
const ui = useUiStore();
const { onBackdropClick, resetBackdropClicks } = useBackdropClose();

/** 空白区域点击关窗(新建为草稿式表单,放弃即关,不弹保存询问) */
function closeOnBackdrop() {
  if (onBackdropClick()) emit("cancel");
}

const form = reactive({ name: "", title: "", description: "", date: "", cover: "", author: "", aigc: "" as "" | AigcDeclaration, hidden: false, toc: false as boolean });
const importing = ref(false);
const inputRef = ref<HTMLInputElement>();

/** 是否博客站点:决定是否显示「页面目录」开关 */
const isBlogSite = computed(() => theme.siteType === "blog");

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetBackdropClicks(); // 空白点击计数随开窗清零
      form.name = "";
      form.title = "";
      form.description = "";
      const d = new Date();
      form.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 00:00:00`;
      form.cover = "";
      form.author = "";
      form.aigc = "";
      form.hidden = false;
      form.toc = false;
      void nextTick(() => inputRef.value?.focus());
    }
  },
);

/** 新文档将位于 dir 下,资产引用按该位置换算前缀 */
function coverPrefix(): string {
  const depth = props.dir ? props.dir.split("/").length : 0;
  return assetRefPrefix(depth);
}

const coverSuggestions = computed(() =>
  site.assetFiles.map((n) => coverPrefix() + n.path.slice(n.path.indexOf("/") + 1)),
);

/** 站内已有文档用过的作者署名:去重后供下拉快速选择(仍可自由输入) */
const authorSuggestions = computed(() => {
  const set = new Set<string>();
  for (const content of Object.values(site.docsCache)) {
    const a = parseFrontMatter(content).data.author?.trim();
    if (a) set.add(a);
  }
  return [...set];
});

/** AIGC 声明三档;选「不显示」时不落字段 */
const aigcOptions = computed(() => [
  { value: "", label: t("editor.aigcHidden") },
  { value: "none", label: t("editor.aigcNone") },
  { value: "present", label: t("editor.aigcPresent") },
]);

/** 选取本地图片导入 asset,直接作为封面 */
async function importCover() {
  importing.value = true;
  try {
    const files = await ipc.pickImages();
    if (!files?.length) return;
    const names = await site.importSiteImages(files);
    if (names.length) form.cover = coverPrefix() + names[0];
  } catch (e) {
    ui.toast(t("editor.imageImportFailed", { msg: ipc.errText(e) }), "error");
  } finally {
    importing.value = false;
  }
}

function submit() {
  const name = form.name.trim();
  if (!name) return;
  emit("confirm", {
    name,
    title: form.title.trim(),
    description: form.description.trim(),
    date: form.date,
    cover: form.cover.trim(),
    author: form.author.trim(),
    aigc: form.aigc,
    hidden: form.hidden,
    toc: form.toc && isBlogSite.value ? "on" : "",
  });
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div class="modal-scrim absolute inset-0" @click="closeOnBackdrop" />
      <div class="modal-card panel relative flex max-h-[86vh] w-full max-w-[400px] flex-col shadow-window" style="max-width: 400px" @click="resetBackdropClicks">
        <header class="flex items-center justify-between px-5 pb-3 pt-4">
          <h2 class="text-[calc(15px*var(--ui-font-scale))] font-semibold">{{ t("tree.newDocTitle") }}</h2>
          <button class="btn-icon" @click="emit('cancel')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div class="flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="field-label">{{ t("tree.docName") }}</span>
              <input ref="inputRef" v-model="form.name" class="input" type="text" :placeholder="t('tree.namePlaceholder')" @keydown.enter="submit" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="field-label">{{ t("editor.fmTitle") }}</span>
              <input v-model="form.title" class="input" type="text" :placeholder="t('editor.fmTitlePlaceholder')" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="field-label">{{ theme.siteType === "blog" ? t("tree.subtitle") : t("editor.fmDescription") }}</span>
              <input v-model="form.description" class="input" type="text" :placeholder="t('tree.subtitlePlaceholder')" />
            </label>
            <div class="flex gap-3">
              <label class="flex flex-1 flex-col gap-1">
                <span class="field-label">{{ t("editor.fmDate") }}</span>
                <DateTimePicker v-model="form.date" />
              </label>
            </div>
            <label class="flex flex-col gap-1">
              <span class="field-label">{{ t("editor.fmAuthor") }}</span>
              <input v-model="form.author" class="input" type="text" list="newDocAuthorOptions" :placeholder="t('editor.fmAuthorPlaceholder')" />
              <datalist id="newDocAuthorOptions">
                <option v-for="a in authorSuggestions" :key="a" :value="a" />
              </datalist>
            </label>
            <label class="flex flex-col gap-1">
              <span class="field-label">{{ t("editor.fmAigc") }}</span>
              <SelectMenu v-model="form.aigc" :options="aigcOptions" align="left" />
            </label>
            <div class="flex flex-col gap-1">
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
            </div>
            <div v-if="isBlogSite" class="flex flex-col gap-1">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  class="checkbox-input"
                  :checked="form.toc"
                  @change="form.toc = ($event.target as HTMLInputElement).checked"
                />
                <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("editor.fmToc") }}</span>
              </label>
              <p class="opt-hint">{{ t("editor.fmTocNewHint") }}</p>
            </div>
            <label class="flex flex-col gap-1">
              <span class="field-label">{{ t("editor.fmCover") }}</span>
              <div class="flex gap-2">
                <input v-model="form.cover" class="input min-w-0 flex-1" type="text" list="newDocCoverOptions" :placeholder="t('editor.fmCoverHint')" />
                <button type="button" class="btn btn-secondary shrink-0" :disabled="importing" @click="importCover">
                  <AppIcon name="download" :size="14" />
                  {{ t("editor.fmCoverImport") }}
                </button>
              </div>
              <datalist id="newDocCoverOptions">
                <option v-for="s in coverSuggestions" :key="s" :value="s" />
              </datalist>
            </label>
            <p class="text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("tree.newDocFmHint") }}</p>
          </div>
        </div>
        <footer class="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
          <button class="btn btn-primary" :disabled="!form.name.trim()" @click="submit">{{ t("common.create") }}</button>
        </footer>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>
