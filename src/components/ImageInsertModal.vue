<script setup lang="ts">
/** 插入图片配置弹窗:Markdown 图片 / HTML 代码嵌入两种方式;
 *  HTML 嵌入可再设置对齐、宽高(百分比或像素)与 class(如 mws_ps_imgpreview
 *  可配合站点图片预览插件)。本地文件在确认后按用户选择的目标路径复制进站点。 */
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import Modal from "./Modal.vue";
import SelectMenu from "./SelectMenu.vue";

export interface ImageInsertSource {
  /** 本地文件(确认后复制进站点)或站点内已有资产(直接引用) */
  kind: "local" | "asset";
  /** 本地绝对路径,或 content/ 相对资产路径 */
  path: string;
}

export interface ImageInsertResult {
  mode: "markdown" | "html";
  /** content/ 相对路径(本地来源为复制后的实际路径,父级按 localSrc 复制) */
  sitePath: string;
  alt: string;
  align: "none" | "left" | "center" | "right";
  /** 尺寸属性值:空 = 不设置;"80%" 或 "640" */
  width: string;
  height: string;
  /** img 的 class(与站点插件呼应),空 = 不写 */
  klass: string;
  /** 本地来源的原始路径(父级据此复制) */
  localSrc?: string;
}

const props = defineProps<{ open: boolean; source: ImageInsertSource | null }>();
const emit = defineEmits<{ confirm: [result: ImageInsertResult]; cancel: [] }>();

const { t } = useI18n();

const state = reactive({
  mode: "markdown" as ImageInsertResult["mode"],
  dest: "",
  alt: "",
  align: "none" as ImageInsertResult["align"],
  widthValue: "",
  widthUnit: "%",
  heightValue: "",
  heightUnit: "%",
  klass: "",
});

watch(
  () => props.open,
  (open) => {
    if (!open || !props.source) return;
    const name = props.source.path.replace(/\\/g, "/").split("/").pop() ?? "";
    state.mode = "markdown";
    state.dest = `asset/${name}`;
    state.alt = name.replace(/\.[a-z0-9]+$/i, "");
    state.align = "none";
    state.widthValue = "";
    state.widthUnit = "%";
    state.heightValue = "";
    state.heightUnit = "%";
    state.klass = "";
  },
);

const isAsset = computed(() => props.source?.kind === "asset");

const modeOptions = computed(() => [
  { value: "markdown", label: t("imageInsert.modeMarkdown") },
  { value: "html", label: t("imageInsert.modeHtml") },
]);
const alignOptions = computed(() => [
  { value: "none", label: t("imageInsert.alignNone") },
  { value: "center", label: t("imageInsert.alignCenter") },
  { value: "left", label: t("imageInsert.alignLeft") },
  { value: "right", label: t("imageInsert.alignRight") },
]);
const unitOptions = computed(() => [
  { value: "%", label: "%" },
  { value: "px", label: "px" },
]);

/** 尺寸属性值:数值合法时按单位输出(像素取整),留空或非法 = 不设置 */
function sizeAttr(value: string, unit: string): string {
  const v = value.trim();
  if (!v || !/^\d+(\.\d+)?$/.test(v)) return "";
  return unit === "px" ? String(Math.round(Number(v))) : `${v}%`;
}
const widthAttr = computed(() => sizeAttr(state.widthValue, state.widthUnit));
const heightAttr = computed(() => sizeAttr(state.heightValue, state.heightUnit));

/** 站内路径校验:非空且不含空段/上跳段(与导入命令的拒绝规则一致) */
const destValid = computed(() => {
  if (isAsset.value) return true;
  const d = state.dest.trim().replace(/^\/+/, "");
  return !!d && !d.split("/").some((seg) => seg === ".." || seg === "");
});

function confirm() {
  if (!props.source || !destValid.value) return;
  emit("confirm", {
    mode: state.mode,
    sitePath: isAsset.value ? props.source.path : state.dest.trim().replace(/^\/+/, ""),
    alt: state.alt.trim(),
    align: state.align,
    width: widthAttr.value,
    height: heightAttr.value,
    klass: state.klass.trim(),
    localSrc: isAsset.value ? undefined : props.source.path,
  });
}
</script>

<template>
  <Modal v-if="open && source" :title="t('imageInsert.title')" :width="420" @cancel="emit('cancel')">
    <div class="flex flex-col gap-3">
      <div>
        <span class="field-label">{{ t("imageInsert.source") }}</span>
        <p class="mono truncate rounded border border-line bg-surface-2 px-2 py-1.5 text-[calc(12px*var(--ui-font-scale))] text-ink-2" :title="source.path">
          {{ source.kind === "asset" ? t("imageInsert.sourceAsset") + " · " : "" }}{{ source.path }}
        </p>
      </div>

      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("imageInsert.mode") }}</span>
        <SelectMenu v-model="state.mode" :options="modeOptions" align="left" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("imageInsert.sitePath") }}</span>
        <input
          v-model="state.dest"
          class="input mono"
          type="text"
          spellcheck="false"
          :disabled="isAsset"
          :placeholder="t('imageInsert.sitePathPlaceholder')"
        />
        <p v-if="isAsset" class="opt-hint">{{ t("imageInsert.sitePathAssetHint") }}</p>
      </label>

      <label class="flex flex-col gap-1">
        <span class="field-label">{{ t("imageInsert.alt") }}</span>
        <input v-model="state.alt" class="input" type="text" :placeholder="t('imageInsert.altPlaceholder')" />
      </label>

      <template v-if="state.mode === 'html'">
        <div class="my-0.5 border-t border-line" />
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("imageInsert.align") }}</span>
          <SelectMenu v-model="state.align" :options="alignOptions" align="left" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="field-label">{{ t("imageInsert.width") }}</span>
            <div class="flex gap-1.5">
              <input v-model="state.widthValue" class="input min-w-0 flex-1" type="text" inputmode="decimal" placeholder="—" />
              <SelectMenu v-model="state.widthUnit" :options="unitOptions" class="w-[74px] shrink-0" align="left" />
            </div>
          </label>
          <label class="flex flex-col gap-1">
            <span class="field-label">{{ t("imageInsert.height") }}</span>
            <div class="flex gap-1.5">
              <input v-model="state.heightValue" class="input min-w-0 flex-1" type="text" inputmode="decimal" placeholder="—" />
              <SelectMenu v-model="state.heightUnit" :options="unitOptions" class="w-[74px] shrink-0" align="left" />
            </div>
          </label>
        </div>
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("imageInsert.class") }}</span>
          <input v-model="state.klass" class="input mono" type="text" spellcheck="false" placeholder="mws_ps_imgpreview" />
          <p class="opt-hint">{{ t("imageInsert.classHint") }}</p>
        </label>
      </template>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('cancel')">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" :disabled="!destValid" @click="confirm">{{ t("imageInsert.insert") }}</button>
    </template>
  </Modal>
</template>
