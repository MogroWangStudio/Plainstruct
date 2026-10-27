<script setup lang="ts">
/** 局域网同步页:服务开关、设备发现、站点互传(发送/拉取)。
 *  桌面与移动共用同一视图;传输与接收确认对话框分别挂在本页与全局层。 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useLanStore } from "@/stores/lan";
import { useSiteStore } from "@/stores/site";
import { ipc } from "@/ipc/ipc";
import type { LanPeer, LanSiteBrief } from "@/ipc/types";
import { formatSize } from "@/lib/format";
import { platformLabel } from "@/lib/platform";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();
const lan = useLanStore();
const site = useSiteStore();

onMounted(() => {
  void lan.refreshStatus();
  if (lan.running) void lan.scan();
});

/* ---------- 服务开关 ---------- */

const starting = ref(false);
async function toggleService() {
  starting.value = true;
  try {
    if (lan.running) {
      await lan.stop();
    } else {
      await lan.start();
      void lan.scan();
    }
  } finally {
    starting.value = false;
  }
}

/* ---------- 设备名 ---------- */

const nameEditing = ref(false);
const nameDraft = ref("");
function startNameEdit() {
  nameDraft.value = lan.deviceName;
  nameEditing.value = true;
}
async function saveName() {
  nameEditing.value = false;
  const name = nameDraft.value.trim();
  if (name && name !== lan.deviceName) await lan.setDeviceName(name);
}

/* ---------- 设备与站点 ---------- */

const expanded = ref<Set<string>>(new Set());
function toggleExpand(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

function peerKey(p: LanPeer): string {
  return `${p.ip}:${p.port}/${p.session}`;
}
function peerIcon(platform: string): string {
  return platform === "android" || platform === "ios" ? "smartphone" : "monitor";
}

/** 本机站点库(发送源选择);当前打开的站点优先展示 */
const library = ref<LanSiteBrief[]>([]);
async function loadLibrary() {
  try {
    library.value = await ipc.lanLocalSites();
  } catch {
    library.value = [];
  }
}
onMounted(loadLibrary);

const sendPickerFor = ref<LanPeer | null>(null);

/** 拉取模式(prepare 阶段选择):另存副本 / 覆盖同名 */
const pullMode = ref<"copy" | "replace">("copy");

/** 发送:优先用当前打开的站点(其根目录已知),否则从站点库选择 */
function beginSendCurrent(peer: LanPeer) {
  if (!site.open || !site.config) {
    sendPickerFor.value = peer;
    return;
  }
  void runSend(peer, site.root, site.config.name);
}

function sitePath(name: string): string {
  return `${app.bootstrap?.appDataDir ?? ""}/sites/${name}`;
}

async function runSend(peer: LanPeer, siteRoot: string, siteName: string) {
  lan.beginSend(peer, siteName);
  await lan.sendSite(peer, siteRoot);
}

function pickSendFromLibrary(name: string) {
  const peer = sendPickerFor.value;
  sendPickerFor.value = null;
  if (!peer) return;
  void runSend(peer, sitePath(name), name);
}

/** 拉取:同名站点时让用户选择覆盖或另存副本(模式在传输对话框内选择) */
function beginPull(peer: LanPeer, brief: LanSiteBrief) {
  lan.beginPull(peer, brief.name);
}

/* ---------- 移动端宽屏复用:桌面下也保持居中窄栏,无额外分支 ---------- */

const scanningNote = computed(() => (lan.scanning ? t("lan.scanning") : t("lan.scanHint")));
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-5 py-8 sm:px-6">
      <header>
        <h1 class="text-[calc(17px*var(--ui-font-scale))] font-semibold">{{ t("lan.title") }}</h1>
        <p class="mt-1 text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("lan.subtitle") }}</p>
      </header>

      <!-- 服务 -->
      <section class="rounded-lg border border-line bg-surface">
        <div class="flex items-center gap-3 px-4 py-3.5">
          <div class="min-w-0 flex-1">
            <p class="text-[calc(13.5px*var(--ui-font-scale))] font-medium">{{ t("lan.serviceTitle") }}</p>
            <p class="mt-0.5 text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">
              {{ lan.running ? t("lan.serviceOn", { name: lan.deviceName }) : t("lan.serviceOff") }}
            </p>
          </div>
          <button
            class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors"
            :class="lan.running ? 'bg-accent' : 'bg-line-strong'"
            role="switch"
            :aria-checked="lan.running"
            :disabled="starting"
            @click="toggleService"
          >
            <span
              class="inline-block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform"
              :class="lan.running ? 'translate-x-[22px]' : 'translate-x-[4px]'"
            />
          </button>
        </div>

        <template v-if="lan.running">
          <div class="flex items-center gap-3 border-t border-line px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="text-[calc(13.5px*var(--ui-font-scale))] font-medium">{{ t("lan.deviceNameLabel") }}</p>
              <p class="mt-0.5 text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("lan.deviceNameHint") }}</p>
            </div>
            <input
              v-if="nameEditing"
              v-model="nameDraft"
              class="input w-36"
              type="text"
              maxlength="24"
              autofocus
              @keydown.enter="saveName"
              @blur="saveName"
            />
            <button v-else class="btn btn-sm btn-secondary gap-1.5" @click="startNameEdit">
              {{ lan.deviceName }}
              <AppIcon name="pencil" :size="13" />
            </button>
          </div>

          <div class="flex items-center gap-3 border-t border-line px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="text-[calc(13.5px*var(--ui-font-scale))] font-medium">{{ t("lan.trustLabel") }}</p>
              <p class="mt-0.5 text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("lan.trustHint") }}</p>
            </div>
            <button
              class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors"
              :class="lan.trusted ? 'bg-accent' : 'bg-line-strong'"
              role="switch"
              :aria-checked="lan.trusted"
              @click="lan.setTrusted(!lan.trusted)"
            >
              <span
                class="inline-block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform"
                :class="lan.trusted ? 'translate-x-[22px]' : 'translate-x-[4px]'"
              />
            </button>
          </div>
        </template>
      </section>

      <!-- 附近设备 -->
      <section v-if="lan.running" class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-[calc(14px*var(--ui-font-scale))] font-semibold">{{ t("lan.nearbyTitle") }}</h2>
          <button class="btn btn-sm btn-secondary gap-1.5" :disabled="lan.scanning" @click="lan.scan()">
            <AppIcon name="refresh" :size="14" :class="{ 'animate-spin': lan.scanning }" />
            {{ t("lan.scan") }}
          </button>
        </div>

        <div
          v-if="!lan.peers.length"
          class="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[calc(13px*var(--ui-font-scale))] text-ink-3"
        >
          {{ scanningNote }}
        </div>

        <div v-else class="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <div v-for="peer in lan.peers" :key="peerKey(peer)" class="px-4 py-3.5">
            <div class="flex items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                <AppIcon :name="peerIcon(peer.platform)" :size="17" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2 text-[calc(13.5px*var(--ui-font-scale))] font-medium">
                  <span class="truncate">{{ peer.name || peer.ip }}</span>
                  <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">
                    {{ platformLabel(peer.platform) }}
                  </span>
                  <span
                    v-if="peer.trusted"
                    class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3"
                  >
                    {{ t("lan.peerTrusted") }}
                  </span>
                </p>
                <p class="mt-0.5 truncate text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">
                  {{ peer.ip }} · {{ t("lan.peerSiteCount", { n: peer.sites.length }) }}
                </p>
              </div>
              <button class="btn btn-sm btn-secondary shrink-0 gap-1.5" @click="beginSendCurrent(peer)">
                <AppIcon name="upload" :size="14" />
                {{ t("lan.sendAction") }}
              </button>
              <button
                v-if="peer.sites.length"
                class="btn-icon shrink-0"
                :aria-label="t('lan.expandSites')"
                @click="toggleExpand(peerKey(peer))"
              >
                <AppIcon :name="expanded.has(peerKey(peer)) ? 'chevronUp' : 'chevronDown'" :size="15" />
              </button>
            </div>

            <!-- 对方站点列表:展开后可逐个拉取 -->
            <div v-if="expanded.has(peerKey(peer))" class="mt-1 divide-y divide-line">
              <div v-for="brief in peer.sites" :key="brief.name" class="flex items-center gap-3 py-2.5 pl-12">
                <AppIcon name="doc" :size="14" class="shrink-0 text-ink-3" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[calc(13px*var(--ui-font-scale))]">{{ brief.name }}</p>
                  <p class="text-[calc(11px*var(--ui-font-scale))] text-ink-3">
                    {{ brief.siteType === "blog" ? t("wizard.typeBlog") : t("wizard.typeDocs") }}
                    <template v-if="brief.sizeBytes"> · {{ formatSize(brief.sizeBytes) }}</template>
                  </p>
                </div>
                <button class="btn btn-sm btn-secondary shrink-0 gap-1.5" @click="beginPull(peer, brief)">
                  <AppIcon name="download" :size="14" />
                  {{ t("lan.pullAction") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <p class="px-1 text-[calc(11.5px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("lan.privacyNote") }}</p>
      </section>

      <!-- 发送源选择(当前没有打开的站点时) -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="sendPickerFor" class="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div class="modal-scrim absolute inset-0" @click="sendPickerFor = null" />
            <div class="modal-card panel relative max-h-[calc(100vh-80px)] w-full max-w-[420px] overflow-y-auto shadow-window">
              <header class="px-6 pb-2 pt-5">
                <h2 class="text-[calc(16px*var(--ui-font-scale))] font-semibold">
                  {{ t("lan.pickSiteTitle", { device: sendPickerFor.name || sendPickerFor.ip }) }}
                </h2>
              </header>
              <div class="flex flex-col gap-1 px-4 pb-2">
                <p v-if="!library.length" class="px-2 py-6 text-center text-[calc(13px*var(--ui-font-scale))] text-ink-3">
                  {{ t("lan.libraryEmpty") }}
                </p>
                <button
                  v-for="brief in library"
                  :key="brief.name"
                  class="flex items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-surface-2"
                  @click="pickSendFromLibrary(brief.name)"
                >
                  <AppIcon name="doc" :size="15" class="shrink-0 text-ink-3" />
                  <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))]">{{ brief.name }}</span>
                  <span class="shrink-0 text-[calc(11px*var(--ui-font-scale))] text-ink-3">{{ formatSize(brief.sizeBytes) }}</span>
                </button>
              </div>
              <footer class="mt-2 flex justify-end border-t border-line px-6 py-4">
                <button class="btn btn-secondary" @click="sendPickerFor = null">{{ t("common.cancel") }}</button>
              </footer>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 传输对话框(发送/拉取共用) -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="lan.transfer && lan.transfer.open" class="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div class="modal-scrim absolute inset-0" @click="lan.busy ? null : lan.closeTransfer()" />
            <div class="modal-card panel relative w-full max-w-[420px] shadow-window">
              <header class="px-6 pb-3 pt-5">
                <h2 class="text-[calc(16px*var(--ui-font-scale))] font-semibold">
                  {{
                    lan.transfer.direction === "send"
                      ? t("lan.sendTitle", { device: lan.transfer.peerName })
                      : t("lan.pullTitle", { device: lan.transfer.peerName })
                  }}
                </h2>
                <p class="mt-1 text-[calc(12.5px*var(--ui-font-scale))] text-ink-3">{{ lan.transfer.siteName }}</p>
              </header>

              <div class="px-6 pb-2">
                <!-- 拉取模式:同名站点可覆盖(先自动备份)或另存副本 -->
                <div v-if="lan.transfer.direction === 'pull' && lan.transfer.step === 'prepare'" class="flex flex-col gap-2 pb-2">
                  <button class="mode-choice" :class="{ active: pullMode === 'copy' }" @click="pullMode = 'copy'">
                    <AppIcon name="checkSquare" :size="15" class="shrink-0" />
                    <span>
                      <span class="block text-[calc(13px*var(--ui-font-scale))] font-medium">{{ t("lan.modeCopy") }}</span>
                      <span class="block text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ t("lan.modeCopyHint") }}</span>
                    </span>
                  </button>
                  <button class="mode-choice" :class="{ active: pullMode === 'replace' }" @click="pullMode = 'replace'">
                    <AppIcon name="alert" :size="15" class="shrink-0" />
                    <span>
                      <span class="block text-[calc(13px*var(--ui-font-scale))] font-medium">{{ t("lan.modeReplace") }}</span>
                      <span class="block text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ t("lan.modeReplaceHint") }}</span>
                    </span>
                  </button>
                </div>

                <!-- 步骤状态 -->
                <div v-else class="flex flex-col items-center gap-3 py-6">
                  <template v-if="lan.transfer.step === 'error'">
                    <AppIcon name="alert" :size="28" class="text-danger" />
                    <p class="text-center text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-2">{{ lan.transfer.error }}</p>
                  </template>
                  <template v-else-if="lan.transfer.step === 'done'">
                    <AppIcon name="check" :size="28" class="text-ok" />
                    <p class="text-center text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-2">
                      {{
                        lan.transfer.direction === "send"
                          ? t("lan.sendDoneBody", { site: lan.transfer.resultSite ?? "" })
                          : t("lan.pullDoneBody", { site: lan.transfer.resultSite ?? "" })
                      }}
                    </p>
                  </template>
                  <template v-else>
                    <span class="flex h-8 w-8 items-center justify-center">
                      <AppIcon
                        name="refresh"
                        :size="24"
                        class="animate-spin text-ink-3"
                      />
                    </span>
                    <p class="text-center text-[calc(13px*var(--ui-font-scale))] text-ink-2">
                      {{
                        lan.transfer.step === "prepare"
                          ? t("lan.stepPrepare")
                          : lan.transfer.step === "request"
                            ? t("lan.stepRequest", { device: lan.transfer.peerName })
                            : t("lan.stepTransfer")
                      }}
                    </p>
                  </template>
                </div>
              </div>

              <footer class="flex justify-end gap-2 border-t border-line px-6 py-4">
                <button class="btn btn-secondary" @click="lan.closeTransfer()">
                  {{ lan.transfer.step === "done" || lan.transfer.step === "error" ? t("common.close") : t("common.cancel") }}
                </button>
                <button
                  v-if="lan.transfer.direction === 'pull' && lan.transfer.step === 'prepare'"
                  class="btn btn-primary"
                  @click="lan.pullSite(lan.transfer.peer, lan.transfer.siteName, pullMode)"
                >
                  {{ t("lan.startPull") }}
                </button>
              </footer>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.mode-choice {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink-2);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain);
}
.mode-choice:hover {
  color: var(--color-ink);
}
.mode-choice.active {
  border-color: var(--color-accent);
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.mode-choice:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
</style>
