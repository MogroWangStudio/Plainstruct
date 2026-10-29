<script setup lang="ts">
/** 局域网推送接收确认:对方设备请求发送站点到本机。
 *  信任网络下推送自动接受,不经过此对话框;非信任网络必须用户明确选择。 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useLanStore } from "@/stores/lan";
import { ipc } from "@/ipc/ipc";
import type { LanSiteBrief } from "@/ipc/types";
import { formatSize } from "@/lib/format";
import { platformLabel } from "@/lib/platform";
import Modal from "./Modal.vue";

const { t } = useI18n();
const lan = useLanStore();

/** 本机是否已有同名站点(决定是否展示「覆盖」选项) */
const hasSameName = ref(false);
watch(
  () => lan.incoming?.siteName,
  async (name) => {
    hasSameName.value = false;
    if (!name) return;
    try {
      const sites: LanSiteBrief[] = await ipc.lanLocalSites();
      hasSameName.value = sites.some((s) => s.name === name);
    } catch {
      hasSameName.value = false;
    }
  },
);

const replacing = computed(() => hasSameName.value);
const busy = ref(false);

async function decide(mode: "copy" | "replace") {
  if (busy.value) return;
  busy.value = true;
  try {
    await lan.acceptIncoming(mode);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal v-if="lan.incoming" :title="t('lan.incomingTitle')" :width="400" @cancel="lan.rejectIncoming()">
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-3">
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[calc(13px*var(--ui-font-scale))] font-medium">{{ lan.incoming.device }}</span>
          <span class="block text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ platformLabel(lan.incoming.devicePlatform) }}</span>
        </span>
      </div>

      <div class="flex items-center gap-3">
        <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))]">{{ lan.incoming.siteName }}</span>
        <span class="shrink-0 text-[calc(12px*var(--ui-font-scale))] text-ink-3">
          {{ formatSize(lan.incoming.sizeBytes) }} {{ t("lan.fileCount", { n: lan.incoming.fileCount }) }}
        </span>
      </div>

      <p class="text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">
        {{ replacing ? t("lan.incomingSameName") : t("lan.incomingBody") }}
      </p>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="lan.rejectIncoming()">{{ t("lan.reject") }}</button>
      <button v-if="replacing" class="btn btn-secondary" :disabled="busy" @click="decide('replace')">
        {{ t("lan.acceptReplace") }}
      </button>
      <button class="btn btn-primary" :disabled="busy" @click="decide('copy')">
        {{ replacing ? t("lan.acceptCopy") : t("lan.accept") }}
      </button>
    </template>
  </Modal>
</template>
