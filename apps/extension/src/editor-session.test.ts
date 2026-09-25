// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { emptyContext, type TranslationContext } from '@sayseed/shared';
import { bindEditorSession } from './editor-session';

afterEach(() => document.body.replaceChildren());
function editorFixture() {
  const editor = document.createElement('div');
  editor.textContent = '我也这么觉得';
  document.body.append(editor);
  vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 80));
  return editor;
}

it('rejects a different reply target even with the same editor node and draft', () => {
  const editor = editorFixture();
  let context: TranslationContext = { ...emptyContext(), mode: 'reply', target: { id: '1', text: 'A post', images: [] } };
  const valid = bindEditorSession(editor, () => context);
  expect(valid()).toBe(true);
  context = { ...context, target: { id: '2', text: 'A post', images: [] } };
  expect(valid()).toBe(false);
});

it('rejects the background editor once a reply dialog opens', () => {
  const editor = editorFixture();
  const valid = bindEditorSession(editor, emptyContext);
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  expect(valid()).toBe(false);
});

it('invalidates a detached or reparented dialog editor', () => {
  const editor = editorFixture();
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  document.body.append(dialog); dialog.append(editor);
  const valid = bindEditorSession(editor, emptyContext);
  expect(valid()).toBe(true);
  document.body.append(editor);
  expect(valid()).toBe(false);
});
