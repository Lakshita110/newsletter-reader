/**
 * One-tap additions picked for her reading: the day's big news (wires and
 * markets she doesn't have yet) and the tech/AI writers in the same orbit as
 * Stratechery and Pragmatic Engineer. Each is checked when added, so a feed
 * that moved fails with a message instead of being saved broken.
 */
export const STARTER_FEEDS: Array<{ name: string; url: string; why: string }> = [
  { name: "Techmeme", url: "https://www.techmeme.com/feed.xml", why: "The day's top tech stories" },
  { name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss", why: "Market moves" },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", why: "World news" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss", why: "World news" },
  { name: "Axios", url: "https://api.axios.com/feed/", why: "Short takes on big stories" },
  { name: "Hacker News (best)", url: "https://hnrss.org/best", why: "What engineers are reading" },
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", why: "Hands-on AI tooling" },
  { name: "Import AI", url: "https://importai.substack.com/feed", why: "Weekly AI research digest" },
  { name: "One Useful Thing", url: "https://www.oneusefulthing.org/feed", why: "Practical AI, Ethan Mollick" },
  { name: "Latent Space", url: "https://www.latent.space/feed", why: "AI engineering" },
  { name: "Benedict Evans", url: "https://www.ben-evans.com/benedictevans?format=rss", why: "Tech strategy" },
  { name: "Not Boring", url: "https://www.notboring.co/feed", why: "Startups and strategy" },
];
