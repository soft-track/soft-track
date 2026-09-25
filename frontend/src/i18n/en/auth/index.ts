// Auth (#106): the signed-out pages, one catalog per page, keyed by the page.
import { fields } from '@/i18n/en/auth/fields'
import { login } from '@/i18n/en/auth/login'
import { register } from '@/i18n/en/auth/register'
import { forgotPassword } from '@/i18n/en/auth/forgotPassword'
import { resetPassword } from '@/i18n/en/auth/resetPassword'
import { invite } from '@/i18n/en/auth/invite'
import { providers } from '@/i18n/en/auth/providers'
import { oauthErrors } from '@/i18n/en/auth/oauthErrors'

export const auth = {
  fields,
  login,
  register,
  forgotPassword,
  resetPassword,
  invite,
  providers,
  oauthErrors,
} as const
