<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePublishStore } from "@/stores/publish";
import { useBuilderStore } from "@/stores/builder";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const publish = usePublishStore();
const builder = useBuilderStore();

// 目标仓库等配置变更后,上一次的验证结果不再可信:清空,直到重新点「验证连接」
watch(
  () => [publish.config.owner, publish.config.repo, publish.config.branch],
  () => {
    publish.verifyResult = null;
  },
);

/* ---------- 运行日志 ---------- */

const logBox = ref<HTMLElement | null>(null);

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 新日志到达时滚动到底部(仅当用户未向上翻阅时贴合底部)
watch(
  () => publish.logs.length,
  async () => {
    await nextTick();
    const box = logBox.value;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  },
);

const canPublish = computed(() => Boolean(publish.config.owner && publish.config.repo && publish.config.token && builder.report));

const progressPct = computed(() =>
  publish.progress && publish.progress.total > 0
    ? Math.round((publish.progress.done / publish.progress.total) * 100)
    : 0,
);

function openPages() {
  void publish.openSite();
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-8 py-10">
      <header>
        <h1 class="text-h1">{{ t("publish.title") }}</h1>
        <p class="mt-1 text-[13px] leading-relaxed text-ink-2">{{ t("publish.subtitle") }}</p>
      </header>

      <section class="panel p-6">
        <div class="flex flex-col gap-5">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="field-label">{{ t("publish.owner") }}</label>
              <input v-model="publish.config.owner" class="input" type="text" :placeholder="t('publish.ownerPlaceholder')" />
            </div>
            <div>
              <label class="field-label">{{ t("publish.repo") }}</label>
              <input v-model="publish.config.repo" class="input" type="text" :placeholder="t('publish.repoPlaceholder')" />
            </div>
          </div>

          <div>
            <label class="field-label">{{ t("publish.branch") }}</label>
            <input v-model="publish.config.branch" class="input !w-48" type="text" :placeholder="t('publish.branchPlaceholder')" />
          </div>

          <div>
            <label class="field-label">{{ t("publish.token") }}</label>
            <input v-model="publish.config.token" class="input mono !text-[12.5px]" type="password" :placeholder="t('publish.tokenPlaceholder')" />
            <p class="field-hint">{{ t("publish.tokenHint") }}</p>
          </div>

          <label class="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input v-model="publish.config.autoCreate" type="checkbox" class="h-[14px] w-[14px] accent-[var(--color-accent)]" />
            {{ t("publish.autoCreate") }}
          </label>

          <div class="flex items-center gap-3">
            <button class="btn btn-secondary" :disabled="publish.verifying || !publish.config.token" @click="publish.verify()">
              {{ publish.verifying ? t("publish.verifying") : t("publish.verify") }}
            </button>
            <span
              v-if="publish.verifyResult"
              class="flex items-center gap-1.5 text-[12.5px]"
              :class="publish.verifyResult.ok ? 'text-ink-2' : 'text-danger'"
            >
              <AppIcon :name="publish.verifyResult.ok ? 'check' : 'alert'" :size="14" />
              <template v-if="publish.verifyResult.ok">
                {{ publish.verifyResult.repoExists ? t("publish.verifyOk", { user: publish.verifyResult.user ?? "", repo: publish.config.repo }) : t("publish.verifyNoRepo", { repo: publish.config.repo }) }}
              </template>
              <template v-else>{{ publish.verifyResult.message === "invalid-token" ? t("publish.verifyNoToken") : publish.verifyResult.message }}</template>
            </span>
          </div>
        </div>
      </section>

      <!-- 发布 -->
      <section class="panel p-6">
        <div class="flex items-center gap-3">
          <button
            class="btn btn-primary"
            :disabled="!canPublish || publish.syncing"
            @click="publish.sync()"
          >
            <AppIcon name="upload" :size="15" />
            {{ publish.syncing ? t("publish.publishing") : t("publish.publish") }}
          </button>
          <span v-if="!builder.report" class="text-[12.5px] text-ink-3">{{ t("publish.buildFirst") }}</span>
        </div>

        <!-- 进度 -->
        <div v-if="publish.syncing && publish.progress" class="mt-5">
          <div class="mb-2 flex items-center justify-between text-[12.5px] text-ink-2">
            <span>{{ t("publish.progress", { done: publish.progress.done, total: publish.progress.total }) }}</span>
            <span class="mono">{{ progressPct }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div class="h-full rounded-full bg-accent transition-[width] duration-200 ease-(--ease-plain)" :style="{ width: progressPct + '%' }" />
          </div>
        </div>

        <!-- 结果 -->
        <div v-if="publish.result" class="mt-5 flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <p class="flex items-center gap-2 text-[13.5px] font-semibold">
            <AppIcon name="check" :size="16" class="text-ink" />
            {{ t("publish.done") }}
          </p>
          <p class="mono text-[12px] text-ink-2">{{ t("publish.commit", { sha: publish.result.commitSha.slice(0, 7) }) }}</p>
          <button class="btn btn-secondary !w-fit" :disabled="publish.checkingDeploy" @click="openPages">
            <AppIcon name="refresh" :size="14" :class="{ 'animate-spin': publish.checkingDeploy }" />
            {{ publish.checkingDeploy ? t("publish.waitingDeploy") : t("publish.viewSite") }}
          </button>
        </div>

        <p v-if="publish.error" class="mt-5 rounded-lg border border-line bg-danger-soft px-4 py-3 text-[12.5px] leading-relaxed text-danger">
          {{ publish.error }}
        </p>

        <p class="field-hint mt-5">{{ t("publish.security") }}</p>
      </section>

      <!-- 运行日志:发布过程与状态实时反馈,报错可在此定位 -->
      <section aria-label="log">
        <div class="flex items-center justify-between">
          <h2 class="text-title">{{ t("publish.logTitle") }}</h2>
          <button
            class="btn-icon"
            :disabled="publish.logs.length === 0"
            :title="t('publish.logClear')"
            @click="publish.clearLogs()"
          >
            <AppIcon name="trash" :size="15" />
          </button>
        </div>
        <div ref="logBox" class="log-box mt-2">
          <p v-if="publish.logs.length === 0" class="px-4 py-3 text-[12px] text-ink-3">
            {{ t("publish.logEmpty") }}
          </p>
          <p
            v-for="(entry, i) in publish.logs"
            :key="i"
            class="log-line"
            :class="`is-${entry.level}`"
          >
            <span class="log-time">{{ formatTime(entry.time) }}</span>
            <span class="log-text">{{ entry.message }}</span>
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 运行日志:控制台式面板,等宽排印,级别着色 */
.log-box {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-2);
  padding: 8px 0;
}
.log-line {
  display: flex;
  gap: 10px;
  padding: 2px 14px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.7;
}
.log-time {
  flex-shrink: 0;
  color: var(--color-ink-3);
}
.log-text {
  word-break: break-all;
  white-space: pre-wrap;
}
.log-line.is-info .log-text {
  color: var(--color-ink-2);
}
.log-line.is-success .log-text {
  color: var(--color-ink);
  font-weight: 600;
}
.log-line.is-error .log-text {
  color: var(--color-danger);
}
</style>
