<script setup lang="ts">
import { reactive, ref, watch } from "vue";
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
/** Logo 加载失败时显示占位图标,不渲染 Chromium 的失败占位 */
const logoFailed = ref(false);
watch(
  () => site.config?.logo,
  () => (logoFailed.value = false),
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
      titleFormat: form.titleFormat.trim() || undefined,
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
              v-model="form.titleFormat"
              class="input"
              type="text"
              :placeholder="t('site.titleFormatPlaceholder')"
              spellcheck="false"
            />
            <p class="field-hint">{{ t("site.titleFormatHint") }}</p>
          </div>
          <div>
            <label class="field-label">{{ t("site.language") }}</label>
            <SelectMenu v-model="form.locale" :options="languageOptions" align="left" />
            <input
              v-if="form.locale === CUSTOM_LOCALE"
              v-model="form.customLocale"
              class="input mt-2 h-8 w-full max-w-[220px] text-[12.5px]"
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
        <p class="break-all rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-2">{{ site.root }}</p>
        <p class="field-hint">{{ t("site.folderHint") }}</p>
        <button class="btn btn-secondary mt-3" @click="openFolder">
          <AppIcon name="external" :size="15" />
          {{ t("site.openFolder") }}
        </button>
      </section>
    </div>
  </div>
</template>
