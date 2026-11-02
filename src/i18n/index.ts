import { createI18n } from "vue-i18n";
import zhCN from "./zh-CN";
import enUS from "./en-US";
import jaJP from "./ja-JP";
import koKR from "./ko-KR";
import frFR from "./fr-FR";
import deDE from "./de-DE";
import esES from "./es-ES";
import ptBR from "./pt-BR";
import ruRU from "./ru-RU";
import type { Locale } from "@/ipc/types";

export type { Locale } from "@/ipc/types";

export const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
    "ja-JP": jaJP,
    "ko-KR": koKR,
    "fr-FR": frFR,
    "de-DE": deDE,
    "es-ES": esES,
    "pt-BR": ptBR,
    "ru-RU": ruRU,
  },
});

/** 界面语言清单:label 用各语言的自称(原生名),切换语言时无需翻译自身 */
export const locales: { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "es-ES", label: "Español" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "ru-RU", label: "Русский" },
];
