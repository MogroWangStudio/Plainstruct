<script setup lang="ts">
/** 移动端目录浏览对话框 —— 系统目录选择器在安卓不可用(dialog 插件无目录树实现,SAF
 *  的 tree URI 也无法映射为构建管线所需的绝对路径),自建浏览:列出子目录、逐级进入、
 *  选定当前文件夹。无「所有文件访问」权限时引导到系统设置手动授予并重试。
 *  桌面不使用(走系统目录选择器)。父级以 v-if 控制出现。 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ipc } from "@/ipc/ipc";
import Modal from "@/components/Modal.vue";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps<{ title: string }>();
const emit = defineEmits<{ select: [path: string]; cancel: [] }>();

const { t } = useI18n();

/** 存储根:安卓内部存储顶层的固定入口 */
const ROOT = "/storage/emulated/0";
const current = ref(ROOT);
const entries = ref<{ name: string; isSite: boolean }[]>([]);
const loading = ref(false);
const denied = ref(false);
const errorText = ref("");

onMounted(load);

async function load() {
  loading.value = true;
  denied.value = false;
  errorText.value = "";
  try {
    entries.value = await ipc.listBrowseDirs(current.value);
  } catch (e) {
    entries.value = [];
    const msg = ipc.errText(e);
    if (msg.includes("storage-denied")) denied.value = true;
    else errorText.value = msg;
  } finally {
    loading.value = false;
  }
}

/** 授权引导后重试:重新探测权限(用户可能已去系统设置授完)并刷新列表 */
async function retry() {
  try {
    await ipc.storageAccessible();
  } catch {
    /* 探测失败按未授权处理,由列表加载再次报错 */
  }
  await load();
}

function enter(name: string) {
  current.value = `${current.value.replace(/\/+$/, "")}/${name}`;
  void load();
}

const canUp = computed(() => current.value !== ROOT);
function up() {
  const p = current.value.replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  if (i > 0) current.value = p.slice(0, i) || "/";
}

/** 路径展示:窄屏放不下全路径,取末两段 */
const currentLabel = computed(() => {
  const parts = current.value.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
});

function choose() {
  emit("select", current.value);
  emit("cancel");
}
</script>

<template>
  <Modal :title="title" @cancel="emit('cancel')">
    <div class="flex flex-col gap-3">
      <!-- 当前位置 + 上一级 -->
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-[calc(12px*var(--ui-font-scale))] text-ink-3 mono">{{ currentLabel }}</span>
        <button class="btn btn-secondary h-8 shrink-0 !px-2.5 !text-[calc(12px*var(--ui-font-scale))]" :disabled="!canUp || loading" @click="up">
          <AppIcon name="arrowLeft" :size="13" />
          {{ t("browse.up") }}
        </button>
      </div>

      <!-- 权限引导 -->
      <div v-if="denied" class="rounded-lg border border-line bg-surface px-4 py-5 text-center">
        <AppIcon name="alert" :size="20" class="mx-auto text-attention" />
        <p class="mt-2 text-[calc(13px*var(--ui-font-scale))] font-medium">{{ t("browse.deniedTitle") }}</p>
        <p class="mt-1.5 text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("browse.deniedBody") }}</p>
        <button class="btn btn-primary mt-3 h-9" :disabled="loading" @click="retry">{{ t("browse.retry") }}</button>
      </div>

      <p v-else-if="errorText" class="text-[calc(12.5px*var(--ui-font-scale))] text-danger">{{ errorText }}</p>

      <!-- 目录列表 -->
      <div v-else class="min-h-[180px] rounded-lg border border-line">
        <p v-if="loading" class="grid min-h-[180px] place-items-center text-[calc(12.5px*var(--ui-font-scale))] text-ink-3">{{ t("common.loading") }}</p>
        <p v-else-if="!entries.length" class="grid min-h-[180px] place-items-center px-4 text-center text-[calc(12.5px*var(--ui-font-scale))] text-ink-3">{{ t("browse.empty") }}</p>
        <div v-else class="divide-y divide-line">
          <button
            v-for="e in entries"
            :key="e.name"
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors active:bg-surface-2"
            @click="enter(e.name)"
          >
            <AppIcon name="folder" :size="16" class="shrink-0 text-ink-3" />
            <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))]">{{ e.name }}</span>
            <span v-if="e.isSite" class="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-2">
              {{ t("browse.isSite") }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-primary w-full" :disabled="denied || loading" @click="choose">
        {{ t("browse.choose") }}
      </button>
    </template>
  </Modal>
</template>
