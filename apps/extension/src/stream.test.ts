import { describe, expect, it } from 'vitest';
import type { TranslationEvent } from '@sayseed/shared';
import { createSseParser } from './stream';

describe('SSE translation protocol', () => {
  it('reassembles every possible chunk boundary including a split CRLF', () => {
    const expected: TranslationEvent[] = [{ type: 'delta', text: 'Hello 世界' }, { type: 'done', text: 'Hello 世界', kind: 'translation' }];
    const body = expected.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
    for (let split = 0; split <= body.length; split++) {
      const seen: TranslationEvent[] = [];
      const parse = createSseParser(event => seen.push(event));
      parse(body.slice(0, split)); parse(body.slice(split));
      expect(seen).toEqual(expected);
    }
  });

  it('handles multiple events per packet without treating malformed data as completion', () => {
    const seen: TranslationEvent[] = [];
    const parse = createSseParser(event => seen.push(event));
    parse(': keepalive\n\ndata: invalid\n\ndata: {"type":"done"}\n\n');
    parse('data: {"type":"delta","text":"A"}\n\ndata: {"type":"error","message":"Disconnected"}\n\n');
    expect(seen).toEqual([{ type: 'delta', text: 'A' }, { type: 'error', message: 'Disconnected' }]);
  });
});
