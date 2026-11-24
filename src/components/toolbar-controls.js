import {
  Bold,
  CheckSquare,
  Code,
  Copy,
  Download,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
} from 'lucide-react';

// One definition per control, rendered wherever it fits: inline in the bar, or
// inside the overflow menu at a width that cannot hold it. A control described
// twice is a control that drifts, so both placements read these lists.
//
// `hint` is what the control really is when you type or press it — a keyboard
// shortcut where the app has one, otherwise the markdown it inserts. It is shown
// in the tooltip and it is never invented: a hint that is not wired up is a lie
// the user finds out about by trying it. The shortcuts here are the ones
// `useEditorPane.handleLocalKeyDown` and App's own key handler answer to.

export const formatControls = [
  {
    id: 'bold',
    label: 'Bold',
    hint: 'Cmd/Ctrl+B',
    keyshortcuts: 'Control+B Meta+B',
    marker: '**',
    activeKey: 'bold',
    icon: Bold,
  },
  {
    id: 'italic',
    label: 'Italic',
    hint: 'Cmd/Ctrl+I',
    keyshortcuts: 'Control+I Meta+I',
    marker: '*',
    activeKey: 'italic',
    icon: Italic,
  },
  {
    id: 'underline',
    label: 'Underline',
    hint: 'Cmd/Ctrl+U',
    keyshortcuts: 'Control+U Meta+U',
    marker: '_',
    activeKey: 'underline',
    icon: Underline,
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    hint: 'Cmd/Ctrl+Shift+S',
    keyshortcuts: 'Control+Shift+S Meta+Shift+S',
    marker: '~~',
    activeKey: 'strike',
    icon: Strikethrough,
  },
];

export const listControls = [
  { id: 'bullet', label: 'Bullet list', hint: 'Markdown: -', icon: List },
  { id: 'numbered', label: 'Numbered list', hint: 'Markdown: 1.', icon: ListOrdered },
  { id: 'task', label: 'Task list', hint: 'Markdown: - [ ]', icon: CheckSquare },
];

// The block controls are the ones the bar drops below `md` — they live in the
// overflow menu there, never nowhere.
export const blockControls = [
  { id: 'quote', label: 'Blockquote', hint: 'Markdown: >', icon: Quote },
  { id: 'code', label: 'Code block', hint: 'Markdown: ```', icon: Code },
  { id: 'link', label: 'Link', hint: 'Markdown: [text](url)', icon: Link },
  { id: 'rule', label: 'Horizontal rule', hint: 'Markdown: ---', icon: Minus },
  { id: 'table', label: 'Table', hint: 'Markdown: | a | b |', icon: Table2 },
];

// The bar cannot hold every control at every width, and the viewport is the
// wrong question — a 1280px window with the notes sidebar open has 208px less
// bar than one without, so a breakpoint guesses wrong at a common size. The bar
// measures itself instead: the block controls stay inline while they fit and go
// to the overflow menu when they do not. Four pixels of slack, because a control
// that ends a pixel inside the edge is still a control nobody can hit.
export const blocksNeedMenu = (contentWidth, availableWidth) => contentWidth + 4 > availableWidth;

// Two of these act on text that may not be there. On an empty note they are
// dead ends — "copied" for an empty string, a confirm dialog to clear nothing —
// so they are disabled and the tooltip says why. Export is not one of them: an
// empty note is still a note, and the file is the point.
export const noteControls = [
  {
    id: 'copy',
    label: 'Copy all content',
    icon: Copy,
    needsText: true,
    emptyReason: 'the note is empty',
  },
  { id: 'export', label: 'Export note', icon: Download },
  {
    id: 'clear',
    label: 'Clear all content',
    icon: Trash2,
    needsText: true,
    emptyReason: 'the note is empty',
    tone: 'danger',
  },
];
