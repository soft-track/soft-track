import 'i18next'

import type { resources } from '@/i18n/resources'

// Keys are typed: `t('members.titel')` is a compile error, not a blank label.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: (typeof resources)['en']
  }
}
