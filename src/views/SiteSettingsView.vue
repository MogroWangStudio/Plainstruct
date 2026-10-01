<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import { useAppStore } from "@/stores/app";
import { ipc } from "@/ipc/ipc";
import type { SiteType } from "@/ipc/types";
import { siteUrl } from "@/lib/preview";
import AppIcon from "@/components/AppIcon.vue";
import SelectMenu from "@/components/SelectMenu.vue";

const { t } = useI18n();
const site = useSiteStore();
const theme = useThemeStore();
const ui = useUiStore();
const app = useAppStore();

/** 预设之外的语言代号走「自定义」输入框 */
const CUSTOM_LOCALE = "__custom__";

const languageOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
  { value: CUSTOM_LOCALE, label: t("site.languageCustom") },
];

const siteTypeOptions = [
  { value: "docs", label: t("wizard.typeDocs") },
  { value: "blog", label: t("wizard.typeBlog") },
];

const form = reactive({
  name: "",
  description: "",
  locale: "zh-CN",
  customLocale: "",
  titleFormat: "",
  siteType: "docs" as SiteType,
});
const saving = ref(false);
const pickingLogo = ref(false);
const pickingFavicon = ref(false);

/** 浏览器标题格式输入框:令牌按钮把占位符插入光标处 */
const titleFormatInput = ref<HTMLInputElement | null>(null);

async function insertTitleToken(token: string) {
  const el = titleFormatInput.value;
  if (!el) {
    form.titleFormat += token;
    return;
  }
  const value = form.titleFormat;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  form.titleFormat = value.slice(0, start) + token + value.slice(end);
  await nextTick();
  el.focus();
  el.setSelectionRange(start + token.length, start + token.length);
}

watch(
  () => site.config,
  (cfg) => {
    if (cfg) {
      form.name = cfg.name;
      form.description = cfg.description ?? "";
      // 已保存的语言不在预设中时,显示为「自定义」并回填代号
      const known = languageOptions.some((o) => o.value === cfg.locale);
      form.locale = cfg.locale && known ? cfg.locale : cfg.locale ? CUSTOM_LOCALE : "zh-CN";
      form.customLocale = cfg.locale && !known ? cfg.locale : "";
      form.titleFormat = cfg.titleFormat ?? "";
      form.siteType = cfg.siteType ?? "docs";
    }
  },
  { immediate: true },
);

const logoUrl = () => (site.config?.logo ? siteUrl(app.platform, `.plainstruct/assets/${site.config.logo}`) : "");
/** 站点外图标未单独设置时回退站点内 Logo(与构建时的回退一致) */
const effectiveFavicon = computed(() => site.config?.favicon ?? site.config?.logo ?? "");
const effectiveFaviconUrl = () =>
  effectiveFavicon.value ? siteUrl(app.platform, `.plainstruct/assets/${effectiveFavicon.value}`) : "";
/** Logo 加载失败时显示占位图标,不渲染 Chromium 的失败占位 */
const logoFailed = ref(false);
watch(
  () => site.config?.logo,
  () => (logoFailed.value = false),
);
const faviconFailed = ref(false);
watch(
  () => [site.config?.favicon, site.config?.logo],
  () => (faviconFailed.value = false),
);

async function save() {
  if (!form.name.trim()) return;
  saving.value = true;
  try {
    // 类型切换连带主题(两套主题互不通用):先落类型与默认主题,再保存其余字段
    const typeChanged = (site.config?.siteType ?? "docs") !== form.siteType;
    if (typeChanged) await theme.applySiteType(form.siteType);
    await site.saveConfig({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      locale:
        form.locale === CUSTOM_LOCALE ? form.customLocale.trim() || undefined : form.locale,
      // 允许显式传空串清除格式(后端收到空串即回退默认连接符);
      // 传 undefined 会被序列化时省略,导致旧格式一直残留
      titleFormat: form.titleFormat.trim(),
    });
    ui.toast(t("site.saved"), "success");
  } catch (e) {
    ui.toast(t("ui.saveFailed", { msg: ipc.errText(e) }), "error");
  } finally {
    saving.value = false;
  }
}

async function chooseLogo() {
  const src = await ipc.pickLogo();
  if (!src) return;
  pickingLogo.value = true;
  try {
    await site.setLogo(src);
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  } finally {
    pickingLogo.value = false;
  }
}

async function removeLogo() {
  try {
    await site.removeLogo();
    ui.toast(t("site.logoRemoved"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

async function chooseFavicon() {
  const src = await ipc.pickLogo();
  if (!src) return;
  pickingFavicon.value = true;
  try {
    await site.setFavicon(src);
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  } finally {
    pickingFavicon.value = false;
  }
}

async function removeFavicon() {
  try {
    await site.removeFavicon();
    ui.toast(t("site.faviconRemoved"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

function openFolder() {
  void ipc.openPath(site.root);
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex w-full max-w-[560px] flex-col gap-8 px-8 py-10">
      <header>
        <h1 class="text-h1">{{ t("site.title") }}</h1>
      </header>

      <!-- 站点信息 -->
      <section class="panel p-6">
        <div class="flex flex-col gap-5">
          <div>
            <label class="field-label">{{ t("site.name") }}</label>
            <input v-model="form.name" class="input" type="text" :placeholder="t('site.namePlaceholder')" />
          </div>
          <div>
            <label class="field-label">{{ t("wizard.siteType") }}</label>
            <SelectMenu v-model="form.siteType" :options="siteTypeOptions" align="left" />
            <p class="field-hint">{{ t("site.siteTypeHint") }}</p>
          </div>
          <div>
            <label class="field-label">{{ t("site.description") }}</label>
            <input v-model="form.description" class="input" type="text" :placeholder="t('site.descriptionPlaceholder')" />
          </div>
          <div>
            <label class="field-label">{{ t("site.titleFormat") }}</label>
            <input
              ref="titleFormatInput"
              v-model="form.titleFormat"
              class="input"
              type="text"
              :placeholder="t('site.titleFormatPlaceholder')"
              spellcheck="false"
            />
            <div class="mt-2 flex gap-1.5">
              <button type="button" class="token-chip" :title="t('site.insertPageToken')" @click="insertTitleToken('{page}')">
                {page}
              </button>
              <button type="button" class="token-chip" :title="t('site.insertSiteToken')" @click="insertTitleToken('{site}')">
                {site}
              </button>
            </div>
            <p class="field-hint">{{ t("site.titleFormatHint") }}</p>
          </div>
          <div>
            <label class="field-label">{{ t("site.language") }}</label>
            <SelectMenu v-model="form.locale" :options="languageOptions" align="left" />
            <input
              v-if="form.locale === CUSTOM_LOCALE"
              v-model="form.customLocale"
              class="input mt-2 h-8 w-full max-w-[220px] text-[calc(12.5px*var(--ui-font-scale))]"
              type="text"
              spellcheck="false"
              :placeholder="t('site.languageCustomPlaceholder')"
            />
            <p class="field-hint">{{ t("site.languageHint") }}</p>
          </div>
          <div>
            <label class="field-label">{{ t("site.logo") }}</label>
            <div class="flex items-center gap-4">
              <img
                v-if="site.config?.logo && !logoFailed"
                :src="logoUrl()"
                alt="logo"
                class="h-12 w-12 rounded-lg border border-line object-cover"
                @error="logoFailed = true"
              />
              <div
                v-else
                class="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-surface-2"
                :class="{ 'border-dashed': !site.config?.logo }"
              >
                <AppIcon name="image" :size="18" class="text-ink-3" />
              </div>
              <div class="flex gap-2">
                <button class="btn btn-secondary" :disabled="pickingLogo" @click="chooseLogo">
                  {{ t("site.chooseLogo") }}
                </button>
                <button v-if="site.config?.logo" class="btn btn-ghost" @click="removeLogo">
                  {{ t("site.removeLogo") }}
                </button>
              </div>
            </div>
            <p class="field-hint">{{ t("site.logoHint") }}</p>
          </div>
          <div>
            <label class="field-label">{{ t("site.favicon") }}</label>
            <div class="flex items-center gap-4">
              <img
                v-if="effectiveFavicon && !faviconFailed"
                :src="effectiveFaviconUrl()"
                alt="favicon"
                class="h-12 w-12 rounded-lg border border-line object-contain p-1"
                @error="faviconFailed = true"
              />
              <div
                v-else
                class="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-surface-2"
                :class="{ 'border-dashed': !effectiveFavicon }"
              >
                <AppIcon name="globe" :size="18" class="text-ink-3" />
              </div>
              <div class="flex gap-2">
                <button class="btn btn-secondary" :disabled="pickingFavicon" @click="chooseFavicon">
                  {{ t("site.chooseFavicon") }}
                </button>
                <button v-if="site.config?.favicon" class="btn btn-ghost" @click="removeFavicon">
                  {{ t("site.removeFavicon") }}
                </button>
              </div>
            </div>
            <p class="field-hint">
              {{ t("site.faviconHint") }}
              <span v-if="!site.config?.favicon && site.config?.logo" class="text-ink-3">
                {{ t("site.faviconFallback") }}
              </span>
            </p>
          </div>
          <div class="flex justify-end">
            <button class="btn btn-primary" :disabled="saving || !form.name.trim()" @click="save">
              {{ t("common.save") }}
            </button>
          </div>
        </div>
      </section>

      <!-- 文件夹信息 -->
      <section class="panel p-6">
        <h2 class="text-title mb-4">{{ t("site.folder") }}</h2>
        <p class="break-all rounded-lg bg-surface-2 px-3 py-2 text-[calc(12px*var(--ui-font-scale))] text-ink-2">{{ site.root }}</p>
        <p class="field-hint">{{ t("site.folderHint") }}</p>
        <button class="btn btn-secondary mt-3" @click="openFolder">
          <AppIcon name="external" :size="15" />
          {{ t("site.openFolder") }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 标题格式令牌按钮:等宽小徽章,点击把占位符插入输入框光标处 */
.token-chip {
  padding: 3px 8px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-ink-2);
  font-family: var(--font-mono);
  font-size: calc(11px * var(--ui-font-scale));
  line-height: 1.4;
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain),
    transform var(--duration-fast) ease-out;
}
.token-chip:hover {
  border-color: var(--color-line-strong);
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.token-chip:active {
  transform: scale(0.95);
}
.token-chip:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
</style>
