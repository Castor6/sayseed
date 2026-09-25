export const overlayCss = `
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #17252c; }
*, *::before, *::after { box-sizing: border-box; }
.panel { position: fixed; z-index: 2147483647; width: min(420px, calc(100vw - 24px)); max-height: min(700px, calc(100vh - 24px)); overflow: auto; padding: 16px; border: 1px solid #d8e5df; border-radius: 18px; background: #fff; box-shadow: 0 12px 40px #13392a30; font-size: 14px; line-height: 1.5; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.between { justify-content: space-between; }
.drag-handle { cursor: grab; touch-action: none; user-select: none; }
.drag-handle:active { cursor: grabbing; }
.drag-handle button { cursor: pointer; }
.panel-obscured { visibility: hidden; }
.title { font-size: 16px; font-weight: 700; }
.muted { color: #61716b; font-size: 12px; }
.error { color: #ae283a; }
.notice { color: #846110; }
button { font: inherit; color: inherit; border: 1px solid #c9d9d1; border-radius: 9px; background: #fff; padding: 6px 10px; cursor: pointer; }
button:hover { background: #eef8f2; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: #176b4a; border-color: #176b4a; color: #fff; }
button.small { padding: 3px 7px; font-size: 12px; }
textarea, select, input { width: 100%; padding: 8px; border: 1px solid #cedbd4; border-radius: 9px; background: #fff; color: #17252c; font: inherit; }
textarea { resize: vertical; min-height: 62px; }
.output { white-space: pre-wrap; min-height: 76px; border: 1px solid #cedbd4; border-radius: 9px; padding: 10px; outline: none; }
.output:focus { border-color: #176b4a; }
.section { margin: 12px 0; }
.label { display: block; font-size: 12px; color: #5b6b64; margin: 0 0 5px; }
.context { padding: 8px; border: 1px solid #e3eae6; border-radius: 10px; margin: 7px 0; }
.context img { width: 60px; height: 60px; object-fit: cover; margin: 4px; }
.bubble { position: fixed; z-index: 2147483647; border-radius: 10px; background: #176b4a; color: white; border: 0; box-shadow: 0 4px 16px #0003; }
.toolbar-button { margin: 0 5px; padding: 4px 8px; color: #17805d; border: 0; background: transparent; font-weight: 700; }
`;
