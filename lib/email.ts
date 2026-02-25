export function parseFrom(from: string) {
  // Examples:
  // "The Pragmatic Engineer <hi@pragmaticengineer.com>"
  // "hi@substack.com"
  const m = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    const email = m[2].trim();
    return { name: name || email, email };
  }
  // no angle brackets
  return { name: from.replace(/^"|"$/g, "").trim() || from.trim(), email: "" };
}

export function normalizePublicationKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}