/**
 * Gmail web deep links for opening a thread in the user's browser.
 *
 * Account selection uses `authuser` (email), not `/u/{email}/` — the path
 * segment is a numeric index (`0`, `1`, …), not the address string.
 */
export function buildGmailThreadUrl(opts: {
  threadId: string;
  authUserEmail?: string | null;
}): string {
  const threadId = opts.threadId.trim();
  const url = new URL('https://mail.google.com/mail/');
  const email = opts.authUserEmail?.trim();
  if (email) {
    url.searchParams.set('authuser', email);
  }
  url.hash = `inbox/${threadId}`;
  return url.toString();
}
