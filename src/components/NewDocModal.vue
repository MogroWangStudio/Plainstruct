<script setup lang="ts">
/** 新建文档弹窗:文档名称与配置头(标题/描述/日期/封面)一次填好,创建时一并写入 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ipc } from "@/ipc/ipc";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps<{ open: boolean; dir: string }>();
const emit = defineEmits<{
  confirm: [payload: { name: string; title: string; description: string; date: string; cover: string }];
  cancel: [];
}>();

const { t } = useI18n();
const site = useSiteStore();
const theme = useThemeStore();
const ui = useUiStore();

const form = reactive({ name: "", title: "", description: "", date: "", cover: "" });
const importing = ref(false);
const inputRef = ref<HTMLInputElement>();

watch(
  () => props.open,
  (open) => {
    if (open) {
      form.name = "";
      form.title = "";
      form.description = "";
      const d = new Date();
      form.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      form.cover = "";
      void nextTick(() => inputRef.value?.focus());
    }
  },
);

/** 新文档将位于 dir 下,images 引用按该位置换算前缀 */
function coverPrefix(): string {
  const depth = props.dir ? props.dir.split("/").length : 0;
  return "../".repeat(depth) + "images/";
}

const coverSuggestions = computed(() => {
  const dir = site.tree.find((n) => n.type === "dir" && n.name.toLowerCase() === "images");
  return (dir?.children ?? [])
    .filter((n) => n.type === "file")
    .map((n) => coverPrefix() + n.name);
});

/** 选取本地图片导入 images,直接作为封面 */
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
  });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div class="absolute inset-0 bg-[var(--color-scrim)]" @click="emit('cancel')" />
      <div class="modal-card panel relative flex max-h-[86vh] w-full max-w-[400px] flex-col shadow-window" style="max-width: 400px">
        <header class="flex items-center justify-between px-5 pb-3 pt-4">
          <h2 class="text-[15px] font-semibold">{{ t("tree.newDocTitle") }}</h2>
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
                <input v-model="form.date" class="input" type="date" />
              </label>
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
            <p class="text-[12px] leading-relaxed text-ink-3">{{ t("tree.newDocFmHint") }}</p>
          </div>
        </div>
        <footer class="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
          <button class="btn btn-primary" :disabled="!form.name.trim()" @click="submit">{{ t("common.create") }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
