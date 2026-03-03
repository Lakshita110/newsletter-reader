import type { gmail_v1 } from "googleapis";
import { parseFrom } from "@/lib/email";

export type NewsletterClassification = {
  isNewsletter: boolean;
  score: number;
  reasons: string[];
};

const STRONG_LIST_HEADERS = [
  "List-Id",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "X-List-Id",
  "X-List",
  "Mailing-List",
];

const NEWSLETTER_TERMS =
  /\b(newsletter|digest|roundup|weekly|monthly|daily|edition|issue|briefing|bulletin|curated|top stories)\b/i;
const FOOTER_TERMS =
  /\b(unsubscribe|manage preferences|email preferences|view in browser|why did i get this)\b/i;
const FROM_AUTOMATION_TERMS =
  /\b(no[\s._-]?reply|newsletter|digest|updates?|bulletin|mail|team|hello)\b/i;
const TRANSACTIONAL_TERMS =
  /\b(password reset|verification code|security alert|receipt|invoice|order|tracking|one[- ]time code|otp)\b/i;
const REPLY_SUBJECT_TERMS = /^(re|fwd):/i;
const PERSONAL_SNIPPET_TERMS =
  /\b(sent from my iphone|let me know|see you|thanks[,!]?|call me|on \w{3}, \w{3,9} \d{1,2})\b/i;
const PERSONAL_MAILBOX_DOMAINS = /@(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com)$/i;

export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

export function classifyNewsletter(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  subject: string,
  from: string,
  snippet: string
): NewsletterClassification {
  let score = 0;
  const reasons: string[] = [];

  let strongListSignal = false;
  for (const name of STRONG_LIST_HEADERS) {
    if (getHeader(headers, name)) {
      strongListSignal = true;
      score += 5;
      reasons.push(`header:${name}`);
      break;
    }
  }

  const precedence = getHeader(headers, "Precedence");
  if (/^(bulk|list|junk)$/i.test(precedence)) {
    score += 2;
    reasons.push("header:Precedence");
  }

  if (getHeader(headers, "Feedback-ID")) {
    score += 2;
    reasons.push("header:Feedback-ID");
  }

  const parsed = parseFrom(from);
  const fromEmail = parsed.email.toLowerCase();
  const fromLocal = fromEmail.split("@")[0] ?? "";
  const hay = `${subject}\n${from}\n${snippet}`;

  if (FROM_AUTOMATION_TERMS.test(fromLocal)) {
    score += 2;
    reasons.push("from:automation");
  }

  if (NEWSLETTER_TERMS.test(hay)) {
    score += 1;
    reasons.push("text:newsletter-terms");
  }

  if (FOOTER_TERMS.test(hay)) {
    score += 2;
    reasons.push("text:footer-terms");
  }

  if (REPLY_SUBJECT_TERMS.test(subject)) {
    score -= 4;
    reasons.push("negative:reply-subject");
  }

  if (TRANSACTIONAL_TERMS.test(hay)) {
    score -= 3;
    reasons.push("negative:transactional");
  }

  if (PERSONAL_SNIPPET_TERMS.test(snippet)) {
    score -= 2;
    reasons.push("negative:personal-snippet");
  }

  if (fromEmail && PERSONAL_MAILBOX_DOMAINS.test(fromEmail) && !strongListSignal) {
    score -= 3;
    reasons.push("negative:personal-domain");
  }

  return {
    isNewsletter: strongListSignal || score >= 3,
    score,
    reasons,
  };
}
