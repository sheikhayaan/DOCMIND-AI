// Converts untrusted API/storage text into a bounded string without coercing objects into prompts.
export function safeText(value: unknown, limit = 20_000): string {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, limit) : '';
}

// Separates an explicit grading rubric from the actual question or answer shown on small screens.
export function splitPrompt(value: unknown): { core: string; rubric: string } {
  const text = safeText(value).replace(/\r\n/g, '\n');
  const marker = /(?:^|\n)\s*(?:#{1,6}\s*|\*\*)?(?:grading rubric|evaluation rubric|rubric|scoring criteria|evaluation criteria)\s*(?::|\*\*|\n)/i.exec(text);
  if (!marker || marker.index === undefined) return { core: text.trim(), rubric: '' };
  return { core: text.slice(0, marker.index).trim(), rubric: text.slice(marker.index).trim() };
}

// Produces a roughly 3–5 second spoken preview rather than reading a verbose rubric aloud.
export function spokenPreview(value: unknown): string {
  const { core } = splitPrompt(value);
  const plain = core.replace(/```[\s\S]*?```/g, ' code example ').replace(/https?:\/\/\S+/g, '').replace(/[#*_`>|\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return plain.replace(/\S{40,}/g, 'long token').split(' ').filter(Boolean).slice(0, 12).join(' ').slice(0, 120);
}

// Advances a finite multi-step flow even when an answer or microphone result is absent.
export function advanceStep(index: number, total: number): number {
  const current = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  return Math.min(count, current + 1);
}
