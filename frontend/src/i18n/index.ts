import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { resources } from '@/i18n/resources'

/**
 * Translation groundwork (#106).
 *
 * One language, English, until the catalog is complete -- a half-translated
 * interface is worse than an English one. The point of this layer now is
 * that new text goes into a catalog instead of into JSX, so the day a second
 * language arrives it is a new folder rather than a pass over every
 * component.
 *
 * Namespaces follow the feature folders -- `settings`, then `issues`, then
 * `board` -- and a folder is converted in one piece, with
 * `scripts/check-i18n.mjs` keeping it converted. `common` holds the words
 * every namespace uses: Cancel, Save, Delete.
 *
 * Initialised synchronously from bundled resources, on import: anything that
 * imports `useTranslation` from here -- a component, or a test rendering one
 * -- gets a ready instance, with no provider and no setup file.
 */
void i18next.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.en),
  // React escapes what it renders; escaping here too would show `&amp;`.
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
})

export { Trans, useTranslation } from 'react-i18next'
export const i18n = i18next

/**
 * Spread onto every `<Trans>` that is given `values`: `<Trans {...userText} …/>`.
 *
 * Trans parses the finished string as markup, so it can place `<strong>` and
 * friends -- and with escaping off (React escapes what it renders), a value
 * containing `<` would be parsed too: a team called "R&D <core>" would lose
 * half its name to a tag that does not exist. This escapes the values on the
 * way into the string and unescapes the text on the way out, so they come
 * out exactly as typed. Plain `t()` does not need it; React escapes those.
 */
export const userText = {
  tOptions: { interpolation: { escapeValue: true } },
  shouldUnescape: true,
} as const
