// i18n bootstrap — PR-1 of multilingual rollout (DE/EN/TR/AR/UK/RU)
// EXTEND_ONLY layer; does not change existing SSOT.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import de from "./locales/de/common.json";
import en from "./locales/en/common.json";
import tr from "./locales/tr/common.json";
import ar from "./locales/ar/common.json";
import uk from "./locales/uk/common.json";
import ru from "./locales/ru/common.json";

export const SUPPORTED_LANGUAGES = [
  { code: "de", label: "Deutsch", native: "Deutsch", flag: "🇩🇪", dir: "ltr" as const },
  { code: "en", label: "English", native: "English", flag: "🇬🇧", dir: "ltr" as const },
  { code: "tr", label: "Türkçe", native: "Türkçe", flag: "🇹🇷", dir: "ltr" as const },
  { code: "ar", label: "العربية", native: "العربية", flag: "🇸🇦", dir: "rtl" as const },
  { code: "uk", label: "Українська", native: "Українська", flag: "🇺🇦", dir: "ltr" as const },
  { code: "ru", label: "Русский", native: "Русский", flag: "🇷🇺", dir: "ltr" as const },
];

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { common: de },
      en: { common: en },
      tr: { common: tr },
      ar: { common: ar },
      uk: { common: uk },
      ru: { common: ru },
    },
    fallbackLng: "de",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "berufos.lang",
      caches: ["localStorage"],
    },
    returnNull: false,
  });

// Apply <html lang> + dir on language change
function applyHtmlLangDir(lang: string) {
  if (typeof document === "undefined") return;
  const meta = SUPPORTED_LANGUAGES.find((l) => l.code === lang) ?? SUPPORTED_LANGUAGES[0];
  document.documentElement.lang = meta.code;
  document.documentElement.dir = meta.dir;
}

applyHtmlLangDir(i18n.language || "de");
i18n.on("languageChanged", applyHtmlLangDir);

export default i18n;
