/**
 * Split article text into pieces short enough to speak one at a time.
 *
 * Why chunk at all: iOS Safari's speechSynthesis silently stops after roughly
 * 15 seconds of a single long utterance, so handing it a whole newsletter
 * reads the first paragraph and then nothing. Queuing sentence-sized pieces
 * avoids that and also lets pause/resume land near where you were.
 */
export function splitForSpeech(text: string, maxChars = 220): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“‘(])/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      if (current) chunks.push(current);
      current = "";
      // A run-on "sentence" (lists, tables): break on commas, then on words.
      for (let i = 0; i < sentence.length; i += maxChars) {
        const slice = sentence.slice(i, i + maxChars);
        const cut = i + maxChars < sentence.length ? Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" ")) : -1;
        if (cut > maxChars / 2) {
          chunks.push(slice.slice(0, cut + 1).trim());
          i -= slice.length - cut - 1;
        } else {
          chunks.push(slice.trim());
        }
      }
      continue;
    }
    if (current && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}
