<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePublishStore } from "@/stores/publish";
import { useBuilderStore } from "@/stores/builder";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { fireConfetti } from "@/lib/confetti";
import AppIcon from "@/components/AppIcon.vue";
import type { GithubAccountType } from "@/ipc/types";

const { t } = useI18n();
const publish = usePublishStore();
const builder = useBuilderStore();
const app = useAppStore();
const ui = useUiStore();

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

/* ---------- 自定义域名 ---------- */

/** 输入容错规范化:与发布端一致 —— 去协议/路径/尾斜杠与尾点,取主机名 */
const domainNormalized = computed(() => {
  let s = publish.config.customDomain.trim().replace(/^https?:\/\//i, "");
  return (s.split(/[/?#]/)[0] ?? "").trim().replace(/\.+$/, "");
});

/** 即时格式校验(与发布端同规则):无效时红字提示,发布端仍会最终把关 */
const domainError = computed(() => {
  const d = domainNormalized.value;
  if (!d) return "";
  const labels = d.split(".");
  const shaped =
    labels.length >= 2 &&
    labels.every((l) => l.length > 0 && !l.startsWith("-") && !l.endsWith("-") && /^[a-zA-Z0-9-]+$/.test(l));
  if (!shaped) return t("publish.domainInvalid");
  if (d.toLowerCase() === "github.io" || d.toLowerCase().endsWith(".github.io")) return t("publish.domainGithubIo");
  return "";
});

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

/** 发布成功且不在发布中:主按钮转绿色打勾,浮现「重新发布」 */
const publishDone = computed(() => Boolean(publish.result && !publish.syncing));

const progressPct = computed(() =>
  publish.progress && publish.progress.total > 0
    ? Math.round((publish.progress.done / publish.progress.total) * 100)
    : 0,
);

function openPages() {
  void publish.openSite();
}

/** 重新发布前确认:发布已完成后再点即重新提交全站,避免误触把远端覆盖一遍 */
async function republish() {
  const ok = await ui.confirmDialog({
    title: t("publish.republishConfirmTitle"),
    body: t("publish.republishConfirmBody", { repo: publish.config.repo }),
    confirmText: t("publish.republishConfirm"),
  });
  if (ok === true) void publish.sync();
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
          <div class="flex flex-col items-center text-center">
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

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="field-label">{{ t("publish.branch") }}</label>
              <input v-model="publish.config.branch" class="input" type="text" :placeholder="t('publish.branchPlaceholder')" />
            </div>
            <div>
              <label class="field-label">{{ t("publish.customDomain") }}</label>
              <input
                v-model="publish.config.customDomain"
                class="input mono"
                type="text"
                :placeholder="t('publish.customDomainPlaceholder')"
                spellcheck="false"
                autocapitalize="off"
              />
            </div>
          </div>
          <p v-if="domainError" class="-mt-2 text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-danger">{{ domainError }}</p>
          <p v-else class="field-hint -mt-2">{{ t("publish.customDomainHint", { owner: publish.config.owner || "yourname" }) }}</p>

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
          <!-- 发布按钮:圆形大号;发布中外圈纯扩散、中心加载环(非线性连贯),
               成功转绿色打勾并浮现「重新发布」;绿色态点击检测 Pages 构建状态 -->
          <div class="publish-orb-wrap">
            <span v-if="publish.syncing" class="orb-ripple" aria-hidden="true" />
            <span v-if="publish.syncing" class="orb-ripple orb-ripple-late" aria-hidden="true" />
            <button
              class="publish-orb"
              :class="{ done: publishDone, syncing: publish.syncing }"
              :disabled="!canPublish || publish.syncing"
              :aria-label="publishDone ? t('publish.viewSite') : t('publish.publish')"
              :title="publishDone ? t('publish.viewSite') : undefined"
              @click="publishDone ? publish.viewPublishedSite() : publish.sync()"
            >
              <span v-if="publish.syncing" class="orb-load" aria-hidden="true"></span>
              <AppIcon v-else :name="publishDone ? 'check' : 'upload'" :size="30" />
            </button>
          </div>
          <p class="orb-label" :class="{ ok: publishDone }">
            {{ publish.syncing ? t("publish.publishing") : publishDone ? t("publish.done") : t("publish.publish") }}
          </p>
          <Transition name="pop">
            <button v-if="publishDone" class="orb-republish" :title="t('publish.republish')" @click="republish">
              <AppIcon name="refresh" :size="16" />
            </button>
          </Transition>
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
          <p v-if="publish.result.customDomain" class="mono text-[calc(12px*var(--ui-font-scale))] text-ink-2">
            {{ t("publish.customDomainApplied", { domain: publish.result.customDomain }) }}
          </p>
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

/* 发布按钮:圆形大号,发布中圆环循环扩散(非线性缓出),成功转绿色打勾 */
.publish-orb-wrap {
  position: relative;
  display: grid;
  place-items: center;
  margin-top: 4px;
}
.publish-orb {
  display: grid;
  place-items: center;
  width: 92px;
  height: 92px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  box-shadow: 0 12px 30px color-mix(in srgb, var(--color-accent) 32%, transparent);
  transition:
    transform 280ms var(--ease-pop),
    background-color 260ms var(--ease-plain),
    box-shadow 320ms var(--ease-plain),
    opacity 200ms ease;
}
.publish-orb:hover:not(:disabled) {
  transform: scale(1.05);
}
.publish-orb:active:not(:disabled) {
  transform: scale(0.95);
}
.publish-orb:disabled {
  opacity: 0.5;
  cursor: default;
}
.publish-orb.done {
  background: var(--color-ok);
  box-shadow: 0 12px 30px color-mix(in srgb, var(--color-ok) 32%, transparent);
}
/* 发布中:外圈纯扩散 —— 圆环自按钮边缘匀速长大的同时透明度长尾渐隐,
   起止都归零,循环点无跳变;两道错相 1/2 周期,任意时刻都有一道在途;
   中心保留同色两段式加减速加载环,「扩散 + 加载」各司其职 */
.publish-orb.syncing {
  cursor: progress;
}
.orb-ripple {
  position: absolute;
  width: 92px;
  height: 92px;
  border: 1.5px solid var(--color-accent);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  animation: orb-ripple 1900ms cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
}
.orb-ripple-late {
  animation-delay: 950ms;
}
@keyframes orb-ripple {
  0% {
    transform: scale(1);
    opacity: 0;
  }
  12% {
    opacity: 0.55;
  }
  85% {
    opacity: 0.12;
  }
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}
/* 中心加载环:与扩散同色的两段式加减速旋转(复用 spin-arc 关键帧),
   边扩散边加载的“加载”即是它 */
.orb-load {
  position: absolute;
  inset: 27px;
  border-radius: 50%;
  border: 3px solid color-mix(in srgb, var(--color-on-accent) 32%, transparent);
  border-top-color: var(--color-on-accent);
  animation: spin-arc 1100ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
.orb-label {
  margin: 0;
  font-size: calc(13px * var(--ui-font-scale));
  font-weight: 550;
  color: var(--color-ink-2);
}
.orb-label.ok {
  color: var(--color-ok);
}
/* 重新发布:成功后浮现的圆形次级按钮 */
.orb-republish {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-top: 2px;
  border: 1px solid var(--color-line);
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-ink-2);
  cursor: pointer;
  transition:
    transform 260ms var(--ease-pop),
    background-color 180ms ease,
    color 180ms ease,
    border-color 180ms ease;
}
.orb-republish:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
  border-color: var(--color-accent);
}
.orb-republish:active {
  transform: scale(0.94);
}
@media (prefers-reduced-motion: reduce) {
  .orb-ripple {
    animation: none;
    opacity: 0;
  }
  .orb-load {
    animation-duration: 2.4s;
  }
  .publish-orb,
  .orb-republish {
    transition: none;
  }
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
