// Pinned Milkdown runtime imports for ChatUI's single-surface Markdown composer.
//
// Version: @milkdown/kit 7.22.0
// Provider: esm.sh
// `bundle=false` is intentional so all Milkdown subpaths share the same pinned
// dependency instances instead of each CDN entry bundling its own ProseMirror/core copy.

export {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx
} from 'https://esm.sh/@milkdown/kit@7.22.0/core?bundle=false&target=es2022';

export { commonmark } from 'https://esm.sh/@milkdown/kit@7.22.0/preset/commonmark?bundle=false&target=es2022';
export { gfm } from 'https://esm.sh/@milkdown/kit@7.22.0/preset/gfm?bundle=false&target=es2022';
export { history } from 'https://esm.sh/@milkdown/kit@7.22.0/plugin/history?bundle=false&target=es2022';
export { clipboard } from 'https://esm.sh/@milkdown/kit@7.22.0/plugin/clipboard?bundle=false&target=es2022';
export { listener, listenerCtx } from 'https://esm.sh/@milkdown/kit@7.22.0/plugin/listener?bundle=false&target=es2022';
export { getMarkdown, replaceAll } from 'https://esm.sh/@milkdown/kit@7.22.0/utils?bundle=false&target=es2022';
