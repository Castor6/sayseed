export type EditorReplacementResult = 'applied' | 'conflict' | 'unsupported' | 'unverified';
export interface EditorReplacementOptions { isCurrent?: () => boolean; signal?: AbortSignal }

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();
const activeReplacements = new WeakSet<HTMLElement>();
interface DraftLeaf { node: HTMLElement; textLength: number }

// Read Draft's rendered leaves, not layout-dependent innerText blank lines.
function draftSnapshot(editor: HTMLElement): { text: string; leaves: DraftLeaf[] } | null {
  if (!editor.matches('.public-DraftEditor-content[contenteditable="true"]')) return null;
  const contents = editor.querySelector('[data-contents="true"]');
  if (!contents || contents.parentElement !== editor) return null;
  const blocks = [...contents.children];
  if (!blocks.length) return null;
  const keys = new Set<string>();
  const leaves: DraftLeaf[] = [];
  const lines: string[] = [];
  for (const block of blocks) {
    const key = block.getAttribute('data-offset-key')?.match(/^([\w]+)-\d+-\d+$/)?.[1];
    if (!block.matches('[data-block="true"]') || !key || keys.has(key)) return null;
    keys.add(key);
    if (block.querySelectorAll('.public-DraftStyleDefault-block').length !== 1) return null;
    const textNodes = [...block.querySelectorAll<HTMLElement>('[data-text="true"]')];
    if (!textNodes.length) return null;
    const leafKeys = new Set<string>();
    let text = '';
    let renderedText = '';
    for (const [index, node] of textNodes.entries()) {
      const leafKey = node.parentElement?.getAttribute('data-offset-key');
      if (!leafKey?.startsWith(`${key}-`) || leafKeys.has(leafKey)) return null;
      leafKeys.add(leafKey);
      if (node.tagName === 'BR') {
        if (textNodes.length !== 1) return null;
      } else if (node.tagName !== 'SPAN' || [...node.childNodes].some(child => child.nodeType !== Node.TEXT_NODE) || /\r/.test(node.textContent || '')) {
        return null;
      }
      const rendered = node.textContent || '';
      // Draft appends one display-only LF when the final leaf ends in a soft newline.
      const logical = index === textNodes.length - 1 && rendered.endsWith('\n\n') ? rendered.slice(0, -1) : rendered;
      renderedText += rendered;
      text += logical;
      leaves.push({ node, textLength: logical.length });
    }
    if (block.textContent !== renderedText) return null;
    lines.push(text);
  }
  if (editor.querySelectorAll('[data-block="true"]').length !== blocks.length) return null;
  return { text: normalize(lines.join('\n')), leaves };
}

export function editorText(editor: HTMLElement): string {
  return draftSnapshot(editor)?.text ?? normalize(editor.innerText || editor.textContent || '');
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));

function selectDraft(editor: HTMLElement, leaves: DraftLeaf[]): Range | null {
  const doc = editor.ownerDocument;
  const selection = doc.getSelection();
  if (!selection || !leaves.length) return null;
  const first = leaves[0]!.node;
  const last = leaves.at(-1)!;
  const start = first.firstChild || first.parentElement!;
  let end: Node = last.node.parentElement!;
  let endOffset = 0;
  let remaining = last.textLength;
  for (const child of last.node.childNodes) {
    const length = child.textContent?.length || 0;
    if (remaining <= length) { end = child; endOffset = remaining; break; }
    remaining -= length;
  }
  const range = doc.createRange();
  range.setStart(start, 0);
  range.setEnd(end, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);
  doc.dispatchEvent(new Event('selectionchange'));
  return range;
}

function selectionMatches(editor: HTMLElement, range: Range): boolean {
  const selection = editor.ownerDocument.getSelection();
  if (selection?.rangeCount !== 1) return false;
  const current = selection.getRangeAt(0);
  return editor.ownerDocument.activeElement === editor && current.startContainer === range.startContainer &&
    current.startOffset === range.startOffset && current.endContainer === range.endContainer && current.endOffset === range.endOffset;
}

export async function replaceEditorText(editor: HTMLElement, expected: string, next: string, options: EditorReplacementOptions = {}): Promise<EditorReplacementResult> {
  const valid = () => editor.isConnected && !options.signal?.aborted && (options.isCurrent?.() ?? true);
  if (!valid() || activeReplacements.has(editor) || editorText(editor) !== normalize(expected)) return 'conflict';
  if (!draftSnapshot(editor) || !normalize(next)) return 'unsupported';
  let paste: ClipboardEvent;
  try {
    const data = new DataTransfer();
    data.setData('text/plain', normalize(next));
    paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true });
    if (paste.clipboardData?.getData('text/plain') !== normalize(next)) return 'unsupported';
  } catch { return 'unsupported'; }

  const doc = editor.ownerDocument;
  let interrupted = false;
  let dispatched = false;
  const interrupt = () => { interrupted = true; };
  const interactions = ['beforeinput', 'compositionstart', 'keydown', 'pointerdown'] as const;
  activeReplacements.add(editor);
  interactions.forEach(type => doc.addEventListener(type, interrupt, true));
  try {
    editor.focus();
    await settle();
    // Focus can update controlled state. Select only after that update has settled.
    if (!valid() || interrupted || editorText(editor) !== normalize(expected)) return 'conflict';
    const snapshot = draftSnapshot(editor);
    if (!snapshot) return 'unsupported';
    const range = selectDraft(editor, snapshot.leaves);
    if (!range) return 'unsupported';
    await settle();
    if (!valid() || interrupted || editorText(editor) !== normalize(expected) || !selectionMatches(editor, range)) return 'conflict';
    dispatched = true;
    editor.dispatchEvent(paste);
    // Synthetic paste has no default insertion. A controlled handler must accept it.
    if (!paste.defaultPrevented) return 'unsupported';
    let consecutiveMatches = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      await settle();
      if (!valid() || interrupted) return 'unverified';
      const current = draftSnapshot(editor);
      consecutiveMatches = current?.text === normalize(next) ? consecutiveMatches + 1 : 0;
      if (consecutiveMatches === 5) return 'applied';
    }
    return 'unverified';
  } catch {
    return dispatched ? 'unverified' : 'unsupported';
  } finally {
    interactions.forEach(type => doc.removeEventListener(type, interrupt, true));
    activeReplacements.delete(editor);
  }
}
