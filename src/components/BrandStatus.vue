<script setup lang="ts">
/** 标题栏状态区:替代品牌旁的应用名,即时反映保存与发布状态;
 *  空闲时显示吉祥物问候语,发布完成后播报祝福语(与发布彩带同帧出现) */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useEditorStore } from "@/stores/editor";
import { usePublishStore } from "@/stores/publish";

const { t } = useI18n();
const editor = useEditorStore();
const publish = usePublishStore();

/* ---------- 问候语:随机起句,周期轮换(仅空闲态可见,轮换在后台持续) ---------- */
const GREETING_KEYS = Array.from({ length: 7 }, (_, i) => `titlebar.greeting${i}`);
const BLESSING_KEYS = Array.from({ length: 4 }, (_, i) => `titlebar.blessing${i}`);
const greetIdx = ref(Math.floor(Math.random() * GREETING_KEYS.length));
let greetTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  greetTimer = setInterval(() => {
    greetIdx.value = (greetIdx.value + 1) % GREETING_KEYS.length;
  }, 45000);
});
onBeforeUnmount(() => {
  if (greetTimer) clearInterval(greetTimer);
});

/* ---------- 祝福语:发布结果出现时播报 12s(与 PublishView 的彩带同帧触发) ---------- */
const blessing = ref("");
let blessingTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => publish.result,
  (val, old) => {
    if (!val || val === old) return;
    blessing.value = t(BLESSING_KEYS[Math.floor(Math.random() * BLESSING_KEYS.length)]);
    if (blessingTimer) clearTimeout(blessingTimer);
    blessingTimer = setTimeout(() => (blessing.value = ""), 12000);
  },
);

/* ---------- 「已保存」闪烁:dirty 收敛的瞬间亮起,2s 后让位问候语 ---------- */
const savedFlash = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => editor.dirty,
  (now, was) => {
    if (was && !now) {
      savedFlash.value = true;
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (savedFlash.value = false), 2000);
    }
  },
);

type StatusKind = "greet" | "bless" | "saving" | "countdown" | "dirty" | "saved" | "publish" | "deploy" | "fail";

/** 单一状态源:发布流程优先(全局动作),其次保存,最后问候;kind 驱动切换动画 */
const status = computed<{ kind: StatusKind; text: string }>(() => {
  if (publish.syncing) {
    const p = publish.progress;
    return { kind: "publish", text: p ? t("titlebar.statusPublishProgress", { done: p.done, total: p.total }) : t("titlebar.statusPublishing") };
  }
  if (publish.checkingDeploy || publish.deployState === "building") return { kind: "deploy", text: t("titlebar.statusDeploying") };
  if (publish.error) return { kind: "fail", text: t("titlebar.statusPublishFailed") };
  if (blessing.value) return { kind: "bless", text: blessing.value };
  if (editor.saving) return { kind: "saving", text: t("titlebar.statusSaving") };
  if (editor.autosaveCountdown !== null) {
    return { kind: "countdown", text: t("titlebar.statusCountdown", { s: Math.max(1, Math.ceil(editor.autosaveCountdown / 1000)) }) };
  }
  if (editor.dirty) return { kind: "dirty", text: t("titlebar.statusDirty") };
  if (savedFlash.value) return { kind: "saved", text: t("titlebar.statusSaved") };
  return { kind: "greet", text: t(GREETING_KEYS[greetIdx.value]) };
});
</script>

<template>
  <span class="brand-status" :class="[`is-${status.kind}`]">
    <Transition name="status-swap" mode="out-in">
      <span :key="status.kind" class="status-text">{{ status.text }}</span>
    </Transition>
  </span>
</template>

<style scoped>
.brand-status {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--color-ink-3);
  font-size: calc(12.5px * var(--ui-font-scale));
  line-height: 1;
  white-space: nowrap;
}
/* 保存与发布是用户动作的直接回声:比问候语重一档;失败用注意色提示 */
.is-saving,
.is-countdown,
.is-publish,
.is-deploy {
  color: var(--color-ink-2);
}
.is-saved,
.is-bless {
  color: var(--color-ink-2);
}
.is-fail {
  color: var(--color-danger);
}
.status-text {
  display: inline-block;
  max-width: 30ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 状态类别切换:短距淡入淡出(位移极小,保持克制);倒计时数字跳动同 kind 不触发 */
.status-swap-enter-active,
.status-swap-leave-active {
  transition:
    opacity 150ms var(--ease-plain),
    transform 150ms var(--ease-plain);
}
.status-swap-enter-from {
  opacity: 0;
  transform: translateY(3px);
}
.status-swap-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
@media (prefers-reduced-motion: reduce) {
  .status-swap-enter-active,
  .status-swap-leave-active {
    transition: none;
  }
}
</style>
