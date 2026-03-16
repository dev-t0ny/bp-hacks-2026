import { fr } from "./fr";
import { en } from "./en";

export type Locale = "fr" | "en";

export type Translations = typeof fr;

export function t(lang: Locale): Translations {
  return lang === "en" ? en : fr;
}

export { fr, en };
