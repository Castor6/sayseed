import type { TranslationEvent } from '@sayseed/shared';

export function createSseParser(onEvent: (event: TranslationEvent) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const delimiter = /\r?\n\r?\n/.exec(buffer);
      if (!delimiter) break;
      const record = buffer.slice(0, delimiter.index);
      buffer = buffer.slice(delimiter.index + delimiter[0].length);
      const data = record.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as TranslationEvent;
        if (parsed.type === 'delta' && typeof parsed.text === 'string' ||
          parsed.type === 'done' && typeof parsed.text === 'string' && ['translation', 'clarification'].includes(parsed.kind) ||
          parsed.type === 'error' && typeof parsed.message === 'string') onEvent(parsed);
      } catch { /* Ignore malformed records and wait for the next valid event. */ }
    }
  };
}
