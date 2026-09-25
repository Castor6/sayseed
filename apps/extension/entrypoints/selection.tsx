import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExplainPanel } from '../src/explain-ui';
import { captureSelection, type CapturedSelection } from '../src/selection';
import { overlayCss } from '../src/style';

export default defineUnlistedScript(() => {
  if ((window as Window & { __sayseedSelection?: boolean }).__sayseedSelection) return;
  (window as Window & { __sayseedSelection?: boolean }).__sayseedSelection = true;
  let current: CapturedSelection | null = null;
  let active = true;
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  function dismiss() { root?.unmount(); root = null; host?.remove(); host = null; }
  function render(open: boolean) {
    dismiss();
    if (!current) return;
    host = document.createElement('div'); host.dataset.sayseedOverlay = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = overlayCss; shadow.append(style);
    const holder = document.createElement('div'); shadow.append(holder); document.body.append(host);
    const rect = current.rect;
    root = createRoot(holder);
    if (!open) {
      root.render(<button className="bubble" style={{ top: Math.min(window.innerHeight - 42, rect.bottom + 7), left: Math.max(8, Math.min(window.innerWidth - 74, rect.left)) }} onMouseDown={e => e.preventDefault()} onClick={() => render(true)}>解释</button>);
    } else {
      root.render(<ExplainPanel initial={{ selection: current.selection, sentence: current.sentence, context: current.context }} sourceKind="webpage" sourceUrl={location.href} sourceTitle={document.title} style={{ top: Math.max(8, Math.min(window.innerHeight - 470, rect.bottom + 10)), left: Math.max(8, Math.min(window.innerWidth - 430, rect.left)) }} onClose={dismiss} />);
    }
  }
  document.addEventListener('mouseup', event => {
    if (!active) return;
    if ((event.target as Element)?.closest?.('[data-sayseed-overlay]')) return;
    const found = captureSelection(window.getSelection());
    if (!found) { if (!host?.contains(event.target as Node)) dismiss(); return; }
    current = found; render(false);
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'sayseed-selection-disable') { active = false; dismiss(); }
    if (message?.type === 'sayseed-selection-enable') active = true;
  });
  chrome.storage.onChanged.addListener(changes => {
    if (changes.webpageSelection) { active = !!changes.webpageSelection.newValue; if (!active) dismiss(); }
  });
});
