/** Denkblöcke entfernen, falls das Modell sie trotz think:false in den Text schreibt. */
export function stripThinking(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const end = t.toLowerCase().lastIndexOf("</think>");
  if (end >= 0) t = t.slice(end + "</think>".length);
  return t.trim();
}

export const stripThinkingForTest = stripThinking;
