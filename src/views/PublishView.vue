<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePublishStore } from "@/stores/publish";
import { useBuilderStore } from "@/stores/builder";
import { useAppStore } from "@/stores/app";
import { fireConfetti } from "@/lib/confetti";
import AppIcon from "@/components/AppIcon.vue";
import type { GithubAccountType } from "@/ipc/types";

const { t } = useI18n();
const publish = usePublishStore();
const builder = useBuilderStore();
const app = useAppStore();

/** 目标仓库等配置变更后,上一次的验证结果不再可信:清空,直到重新点「验证连接」 */
watch(
  () => [publish.config.owner, publish.config.repo, publish.config.branch, publish.config.accountType],
  () => {
    publish.verifyResult = null;
  },
);

/* ---------- 账户类型 ---------- */

const isOrg = computed(() => publish.config.accountType === "org");

/** 切换账户类型:所有者字段的含义随之改变,立即落盘以免切页后丢失 */
function setAccountType(type: GithubAccountType) {
  if (publish.config.accountType === type) return;
  publish.config.accountType = type;
  void publish.save();
}

/** 验证结果的主行文案 */
const verifyText = computed(() => {
  const r = publish.verifyResult;
  if (!r) return "";
  if (!r.ok) {
    if (r.message === "invalid-token") return t("publish.verifyNoToken");
    if (r.message === "owner-empty") return t("publish.verifyNoOwner");
    if (r.message === "org-forbidden") return t("publish.verifyOrgForbidden", { org: publish.config.owner });
    if (r.message === "org-not-found") return t("publish.verifyOrgNotFound", { org: publish.config.owner });
    if (r.message === "repo-forbidden") return t("publish.verifyRepoForbidden", { repo: publish.config.repo });
    return r.message ?? "";
  }
  return r.repoExists
    ? t("publish.verifyOk", { user: r.user ?? "", repo: publish.config.repo })
    : t("publish.verifyNoRepo", { repo: publish.config.repo });
});

/**
 * 配置与 GitHub 实际情况不符时的提醒(不阻断,但发布必然失败):
 * 账户类型选错是旧版最容易踩的坑 —— 把组织名填进「个人用户」,自动建仓会打到
 * /user/repos 上被 GitHub 以 403 拒绝。这里在「验证连接」阶段就点明。
 */
const verifyHints = computed<string[]>(() => {
  const r = publish.verifyResult;
  if (!r) return [];
  const hints: string[] = [];
  if (r.ownerIsOrg === true && !isOrg.value) {
    hints.push(t("publish.hintSwitchToOrg", { owner: publish.config.owner }));
  }
  if (r.ownerIsOrg === false && isOrg.value) {
    hints.push(t("publish.hintSwitchToUser", { owner: publish.config.owner }));
  }
  if (!isOrg.value && r.ownerMatchesUser === false) {
    hints.push(t("publish.hintOwnerMismatch", { user: r.user ?? "", owner: publish.config.owner }));
  }
  return hints;
});

// 发布成功的一刻按设置档位撒一次纸屑(仅 result 从无到有时,回看结果不重播)
watch(
  () => publish.result,
  (val, old) => {
    if (val && !old) fireConfetti(app.settings.confetti ?? "standard");
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
        <p class="mt-1 text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-2">{{ t("publish.subtitle") }}</p>
      </header>

      <section class="panel p-6">
        <div class="flex flex-col gap-5">
          <!-- 账户类型:决定所有者字段填的是什么,也决定自动建仓打到哪个 GitHub 接口 -->
          <div>
            <label class="field-label">{{ t("publish.accountType") }}</label>
            <div class="segmented" role="group" :aria-label="t('publish.accountType')">
              <span class="segmented-pill" :class="{ right: isOrg }" aria-hidden="true" />
              <button
                type="button"
                class="segmented-item"
                :class="{ active: !isOrg }"
                :aria-pressed="!isOrg"
                @click="setAccountType('user')"
              >
                {{ t("publish.accountUser") }}
              </button>
              <button
                type="button"
                class="segmented-item"
                :class="{ active: isOrg }"
                :aria-pressed="isOrg"
                @click="setAccountType('org')"
              >
                {{ t("publish.accountOrg") }}
              </button>
            </div>
            <p class="field-hint">{{ isOrg ? t("publish.accountOrgHint") : t("publish.accountUserHint") }}</p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="field-label">{{ isOrg ? t("publish.ownerOrg") : t("publish.owner") }}</label>
              <input
                v-model="publish.config.owner"
                class="input"
                type="text"
                :placeholder="isOrg ? t('publish.ownerOrgPlaceholder') : t('publish.ownerPlaceholder')"
              />
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
            <input v-model="publish.config.token" class="input mono !text-[calc(12.5px*var(--ui-font-scale))]" type="password" :placeholder="t('publish.tokenPlaceholder')" />
            <p class="field-hint">{{ t("publish.tokenHint") }}</p>
          </div>

          <label class="flex cursor-pointer items-center gap-2 text-[calc(13px*var(--ui-font-scale))] text-ink-2">
            <input v-model="publish.config.autoCreate" type="checkbox" class="checkbox-input" />
            {{ t("publish.autoCreate") }}
          </label>

          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-3">
              <button class="btn btn-secondary" :disabled="publish.verifying || !publish.config.token" @click="publish.verify()">
                {{ publish.verifying ? t("publish.verifying") : t("publish.verify") }}
              </button>
              <span
                v-if="publish.verifyResult"
                class="flex items-start gap-1.5 text-[calc(12.5px*var(--ui-font-scale))]"
                :class="publish.verifyResult.ok ? 'text-ink-2' : 'text-danger'"
              >
                <AppIcon :name="publish.verifyResult.ok ? 'check' : 'alert'" :size="14" class="mt-0.5 shrink-0" />
                <span>{{ verifyText }}</span>
              </span>
            </div>
            <!-- 配置与 GitHub 实际情况不符时的提醒(账户类型选错 / 用户名与令牌账号不符) -->
            <p
              v-for="(hint, i) in verifyHints"
              :key="i"
              class="flex items-start gap-1.5 text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-ink-2"
            >
              <AppIcon name="alert" :size="14" class="mt-0.5 shrink-0 text-ink-3" />
              <span>{{ hint }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- 发布 -->
      <section class="panel p-6">
        <div class="flex flex-col items-center gap-2">
          <!-- 发布按钮:居中加宽;发布中为非线性旋转;成功后变为「重新发布」 -->
          <button
            class="btn btn-primary publish-btn"
            :class="{ 'is-busy': publish.syncing }"
            :disabled="!canPublish || publish.syncing"
            @click="publish.sync()"
          >
            <template v-if="publish.syncing">
              <span class="spin-arc" aria-hidden="true" />
              {{ t("publish.publishing") }}
            </template>
            <template v-else>
              <AppIcon :name="publish.result ? 'refresh' : 'upload'" :size="15" />
              {{ publish.result ? t("publish.republish") : t("publish.publish") }}
            </template>
          </button>
          <span v-if="!builder.report && !publish.syncing" class="text-[calc(12.5px*var(--ui-font-scale))] text-ink-3">{{ t("publish.buildFirst") }}</span>
        </div>

        <!-- 进度 -->
        <div v-if="publish.syncing && publish.progress" class="mt-5">
          <div class="mb-2 flex items-center justify-between text-[calc(12.5px*var(--ui-font-scale))] text-ink-2">
            <span>{{ t("publish.progress", { done: publish.progress.done, total: publish.progress.total }) }}</span>
            <span class="mono">{{ progressPct }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div class="h-full rounded-full bg-accent transition-[width] duration-200 ease-(--ease-plain)" :style="{ width: progressPct + '%' }" />
          </div>
        </div>

        <!-- 结果 -->
        <div v-if="publish.result" class="mt-5 flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <p class="flex items-center gap-2 text-[calc(13.5px*var(--ui-font-scale))] font-semibold">
            <AppIcon name="check" :size="16" class="text-ink" />
            {{ t("publish.done") }}
          </p>
          <p class="mono text-[calc(12px*var(--ui-font-scale))] text-ink-2">{{ t("publish.commit", { sha: publish.result.commitSha.slice(0, 7) }) }}</p>
          <div class="flex flex-wrap gap-2">
            <!-- 查看站点:Pages 构建中禁用并转圈,完成后亮起主色按钮 -->
            <button
              class="btn"
              :class="publish.deployState === 'ready' ? 'btn-primary !w-fit' : 'btn-secondary !w-fit'"
              :disabled="publish.checkingDeploy || publish.deployState === 'building'"
              @click="openPages"
            >
              <span
                v-if="publish.deployState === 'building' || publish.checkingDeploy"
                class="spin-arc spin-arc-secondary"
                aria-hidden="true"
              />
              <AppIcon v-else name="globe" :size="14" />
              {{ publish.deployState === "building" || publish.checkingDeploy ? t("publish.deployBuilding") : t("publish.viewSite") }}
            </button>
            <button class="btn btn-secondary !w-fit" @click="publish.openRepo()">
              <AppIcon name="external" :size="14" />
              {{ t("publish.goRepo") }}
            </button>
          </div>
        </div>

        <p v-if="publish.error" class="mt-5 rounded-lg border border-line bg-danger-soft px-4 py-3 text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-danger">
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
          <p v-if="publish.logs.length === 0" class="px-4 py-3 text-[calc(12px*var(--ui-font-scale))] text-ink-3">
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
/* ---------- 账户类型分段控件 ---------- */
/* 两段等宽的实底选中段:选中态是滑动的药丸,两段同形,一个位移即到达;
   实底而非描边,在浅色与深色主题下都保持同样的选中对比度 */
.segmented {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  width: 232px;
  padding: 2px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-bg);
}
.segmented-pill {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  border-radius: 6px;
  background: var(--color-accent);
  transition: transform var(--duration-slow) var(--ease-plain);
}
.segmented-pill.right {
  transform: translateX(100%);
}
.segmented-item {
  position: relative;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(13px * var(--ui-font-scale));
  cursor: pointer;
  transition:
    color var(--duration-base) var(--ease-plain),
    transform 100ms ease-out;
}
.segmented-item:hover {
  color: var(--color-ink);
}
/* 按下即反馈,不等抬手 */
.segmented-item:active {
  transform: scale(0.97);
}
.segmented-item.active {
  color: var(--color-on-accent);
  font-weight: 500;
}
.segmented-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .segmented-pill {
    transition: none;
  }
  .segmented-item:active {
    transform: none;
  }
}

/* 发布按钮:居中加宽,发布中带非线性旋转弧 */
.publish-btn {
  min-width: 240px;
  justify-content: center;
}

/* 非线性加载弧:两段式加减速旋转(先快后缓再收),比匀速旋转更有节奏 */
.spin-arc {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-on-accent) 35%, transparent);
  border-top-color: var(--color-on-accent);
  animation: spin-arc 1100ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
/* 次级按钮上的加载弧:用墨色 */
.spin-arc-secondary {
  border-color: color-mix(in srgb, var(--color-ink-3) 35%, transparent);
  border-top-color: var(--color-ink-2);
}
@keyframes spin-arc {
  0% {
    transform: rotate(0deg);
  }
  55% {
    transform: rotate(305deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin-arc {
    animation-duration: 2.4s;
  }
}

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
  font-size: calc(11.5px * var(--ui-font-scale));
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
