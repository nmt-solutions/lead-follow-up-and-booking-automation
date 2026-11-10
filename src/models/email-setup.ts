/** Reserved drafts have no provider identity or usable credentials. */
export function isPendingEmailAccount(account: string) {
  return /^connect-[a-f0-9-]{36}@pending\.leadrelay\.invalid$/.test(account);
}
