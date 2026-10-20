import { en, type Messages, type MessageKey } from "./locales/en";
import { zh } from "./locales/zh";
import { hi } from "./locales/hi";
import { es } from "./locales/es";
import { ar } from "./locales/ar";
import { fr } from "./locales/fr";
import { bn } from "./locales/bn";
import { pt } from "./locales/pt";
import { id } from "./locales/id";
import { ur } from "./locales/ur";

export const languages = [
  { code: "en", name: "English", direction: "ltr", numberLocale: "en" },
  {
    code: "zh-Hans",
    name: "简体中文",
    direction: "ltr",
    numberLocale: "zh-Hans",
  },
  { code: "hi", name: "हिन्दी", direction: "ltr", numberLocale: "hi" },
  { code: "es", name: "Español", direction: "ltr", numberLocale: "es" },
  { code: "ar", name: "العربية", direction: "rtl", numberLocale: "ar" },
  { code: "fr", name: "Français", direction: "ltr", numberLocale: "fr" },
  { code: "bn", name: "বাংলা", direction: "ltr", numberLocale: "bn" },
  { code: "pt", name: "Português", direction: "ltr", numberLocale: "pt-BR" },
  {
    code: "id",
    name: "Bahasa Indonesia",
    direction: "ltr",
    numberLocale: "id",
  },
  { code: "ur", name: "اردو", direction: "rtl", numberLocale: "ur" },
] as const;

export type Locale = (typeof languages)[number]["code"];
export type { MessageKey };
export type Params = Record<string, string | number>;
export const messages: Record<Locale, Messages> = {
  en,
  "zh-Hans": zh,
  hi,
  es,
  ar,
  fr,
  bn,
  pt,
  id,
  ur,
};
let currentLocale: Locale = "en";

export function normalizeLocale(
  value: string | null | undefined,
): Locale | null {
  if (!value) return null;
  const base = value.toLowerCase().replaceAll("_", "-").split("-")[0];
  if (base === "zh") return "zh-Hans";
  if (base === "in") return "id";
  return languages.find((language) => language.code === base)?.code ?? null;
}

export function detectLocale(
  urlLanguage: string | null,
  savedLanguage: string | null,
  browserLanguages: readonly string[],
): Locale {
  return (
    normalizeLocale(urlLanguage) ??
    normalizeLocale(savedLanguage) ??
    browserLanguages
      .map(normalizeLocale)
      .find((locale): locale is Locale => locale !== null) ??
    "en"
  );
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
}
export function getLocale() {
  return currentLocale;
}
export function languageInfo(locale: Locale = currentLocale) {
  return languages.find((language) => language.code === locale)!;
}
export function number(
  value: number,
  maximumFractionDigits = 0,
  locale: Locale = currentLocale,
) {
  return new Intl.NumberFormat(languageInfo(locale).numberLocale, {
    maximumFractionDigits,
  }).format(value);
}
export function t(
  key: MessageKey,
  params: Params = {},
  locale: Locale = currentLocale,
): string {
  return messages[locale][key].replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => {
      const value = params[name];
      return typeof value === "number"
        ? number(value, 0, locale)
        : (value ?? placeholder);
    },
  );
}
