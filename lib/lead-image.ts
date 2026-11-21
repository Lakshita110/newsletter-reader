/**
 * Hostname whose favicon represents an item: the article/post URL when there
 * is one (pub.substack.com gives that publication's logo, not Substack's),
 * otherwise the sender's mail domain.
 */
export function faviconDomain(externalUrl?: string | null, from?: string | null): string | null {
  if (externalUrl) {
    try {
      return new URL(externalUrl).hostname.replace(/^www\./, "");
    } catch {
      // fall through to the sender
    }
  }
  const domain = from?.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase();
  if (!domain) return null;
  // Bulk-mail subdomains (mail.beehiiv.com, email.example.com) have no icon of their own.
  return domain.replace(/^(e?mail|news|newsletter|info|send|mg|em\d*)\./, "");
}
