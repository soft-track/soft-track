/**
 * Invitation links.
 *
 * SoftTrack sends no email, so the link is something a person copies and
 * pastes into whatever their team already uses. It is built from the origin
 * the admin is currently looking at, which is the one address the instance is
 * definitely reachable at from where they are.
 */
export function inviteUrl(
  token: string,
  // A parameter with a default rather than a direct read, so the function is
  // callable without a DOM. Default arguments are only evaluated when the
  // argument is omitted, so `window` is never touched in a test.
  origin: string = window.location.origin,
): string {
  return `${origin}/invite/${token}`
}

/** Copy an invite link, reporting whether the browser allowed it. */
export async function copyInviteLink(token: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteUrl(token))
    return true
  } catch {
    // Insecure origin, or permission refused. The caller shows the URL so it
    // can still be copied by hand.
    return false
  }
}
