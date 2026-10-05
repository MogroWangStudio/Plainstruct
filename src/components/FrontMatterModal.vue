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
  /** 博客主页专属:卡片流按分类分组(仅主页配置区展示) */
  homeGroups: boolean;
  /** 博客主页专属:勾选显示的文章(content/ 相对路径);空数组 = 显示全部 */
  homePosts: string[];
}

const props = defineProps<{
  open: boolean;
  /** 目标文档的 content/ 相对路径,决定 asset 前缀换算与封面建议 */
  docPath: string;
  /** 打开时的预填值(通常来自文档现有配置头) */
  initial: FrontMatterForm;
  /** 博客主页(根 index.md)的配置区:候选文章列表;null = 非主页,不显示该区 */
  blogHome?: { posts: { title: string; path: string }[] } | null;
}>();

const emit = defineEmits<{
  confirm: [form: FrontMatterForm];
  cancel: [];
}>();

const { t } = useI18n();
const site = useSiteStore();
const ui = useUiStore();

const form = reactive<FrontMatterForm>({ title: "", description: "", date: "", cover: "", author: "", aigc: "", hidden: false, homeGroups: false, homePosts: [] });

/** AIGC 声明三档;选「不显示」时写回不落字段 */
const aigcOptions = computed(() => [
  { value: "", label: t("editor.aigcHidden") },
  { value: "none", label: t("editor.aigcNone") },
  { value: "present", label: t("editor.aigcPresent") },
]);

/* ---------- 博客主页配置区(仅根 index.md) ---------- */

/** 候选文章是否全部勾选(全勾/全不勾都等价于「显示全部」,写回时不落字段) */
const allPostsSelected = computed(
  () => (props.blogHome?.posts.length ?? 0) > 0 && form.homePosts.length === props.blogHome!.posts.length,
);

function togglePost(path: string, checked: boolean) {
  const set = new Set(form.homePosts);
  if (checked) set.add(path);
  else set.delete(path);
  form.homePosts = [...set];
}

function toggleAllPosts(checked: boolean) {
  form.homePosts = checked ? (props.blogHome?.posts ?? []).map((p) => p.path) : [];
}

/** 确认:主页字段仅在「部分勾选」时落盘 —— 全勾/全不勾与未配置同义(显示全部) */
function confirmForm() {
  const all = props.blogHome?.posts ?? [];
  const selected = all.length ? form.homePosts.filter((p) => all.some((a) => a.path === p)) : [];
  const homePosts = selected.length > 0 && selected.length < all.length ? selected : [];
  emit("confirm", { ...form, homePosts });
}

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

      <!-- 博客主页专属配置区:卡片流分类分组与显示文章(仅根 index.md 显示) -->
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
        <div>
          <div class="flex items-center justify-between">
            <span class="field-label">{{ t("editor.fmHomePosts") }}</span>
            <label class="flex cursor-pointer items-center gap-1.5 text-[calc(12.5px*var(--ui-font-scale))] text-ink-2">
              <input
                type="checkbox"
                class="checkbox-input"
                :checked="allPostsSelected"
                @change="toggleAllPosts(($event.target as HTMLInputElement).checked)"
              />
              {{ t("editor.fmHomeSelectAll") }}
            </label>
          </div>
          <div class="fm-post-list mt-1.5">
            <label
              v-for="p in blogHome.posts"
              :key="p.path"
              class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[calc(12.5px*var(--ui-font-scale))] text-ink-2 hover:bg-surface-2"
            >
              <input
                type="checkbox"
                class="checkbox-input"
                :checked="form.homePosts.includes(p.path)"
                @change="togglePost(p.path, ($event.target as HTMLInputElement).checked)"
              />
              <span class="truncate">{{ p.title }}</span>
            </label>
          </div>
          <p class="opt-hint">{{ t("editor.fmHomePostsHint") }}</p>
        </div>
      </template>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" @click="confirmForm">{{ t("common.save") }}</button>
    </template>
  </Modal>
</template>

<style scoped>
/* 主页文章勾选列表:限高滚动,避免长文章流撑爆弹窗 */
.fm-post-list {
  max-height: 216px;
  overflow-y: auto;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-2);
  padding: 6px;
}
</style>
