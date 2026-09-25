type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function index(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

// OpenAI's Responses adapter currently exposes DeepSeek's reasoning_text only in raw chunks.
export function createResponsesReasoningCollector() {
  const parts = new Map<string, string>();
  const key = (outputIndex: unknown, itemId: unknown, contentIndex: unknown) =>
    `${index(outputIndex) ?? (typeof itemId === 'string' ? itemId : '0')}:${index(contentIndex) ?? 0}`;

  const collectItem = (itemValue: unknown, outputIndex: unknown) => {
    const item = record(itemValue);
    if (item?.type !== 'reasoning' || !Array.isArray(item.content)) return;
    item.content.forEach((contentValue, contentIndex) => {
      const content = record(contentValue);
      if (content?.type === 'reasoning_text' && typeof content.text === 'string' && content.text) {
        parts.set(key(outputIndex, item.id, contentIndex), content.text);
      }
    });
  };

  const collectOutput = (responseValue: unknown) => {
    const response = record(responseValue);
    if (!Array.isArray(response?.output)) return;
    response.output.forEach((item, outputIndex) => collectItem(item, outputIndex));
  };

  return {
    collectChunk(value: unknown) {
      const chunk = record(value);
      if (!chunk) return;
      if (chunk.type === 'response.reasoning_text.delta' && typeof chunk.delta === 'string') {
        const partKey = key(chunk.output_index, chunk.item_id, chunk.content_index);
        parts.set(partKey, (parts.get(partKey) ?? '') + chunk.delta);
      } else if (chunk.type === 'response.reasoning_text.done' && typeof chunk.text === 'string' && chunk.text) {
        parts.set(key(chunk.output_index, chunk.item_id, chunk.content_index), chunk.text);
      } else if (chunk.type === 'response.output_item.done') {
        collectItem(chunk.item, chunk.output_index);
      } else if (chunk.type === 'response.completed' || chunk.type === 'response.incomplete' || chunk.type === 'response.failed') {
        collectOutput(chunk.response);
      }
    },
    collectResponse(value: unknown) { collectOutput(value); },
    text() {
      return [...parts.entries()].sort(([left], [right]) => {
        const [leftItem, leftContent] = left.split(':');
        const [rightItem, rightContent] = right.split(':');
        const itemOrder = Number(leftItem) - Number(rightItem);
        return Number.isNaN(itemOrder) ? left.localeCompare(right) : itemOrder || Number(leftContent) - Number(rightContent);
      }).map(([, value]) => value).join('');
    },
  };
}
