import React, { useRef, useState } from 'react';
import { Bot, Clock, MessageSquare, Tag } from 'lucide-react';
import NoteHistory from './NoteHistory';
import TagsReferences from './TagsReferences';
import AgentTab from './AgentTab';
import NoteThread from './NoteThread';

// The tabs, in the order the arrow keys walk them. One list, so the tablist's
// keyboard rule and the buttons it applies to cannot drift apart. Contents repeated the headings already on screen and was the
// tab everyone scrolled past; jumping to a heading now lives in the command
// palette (Ctrl+K) where searching already happens. What is left each does
// something the note itself cannot.
const HELPER_TABS = [
  // The thread leads, because talking to the agent is the thing a person does
  // while writing, not a place they go afterwards.
  { key: 'thread', label: 'Thread', short: 'Thread', hint: 'Talk to your agent about this note', Icon: MessageSquare },
  { key: 'history', label: 'History', short: 'History', hint: 'Every saved version, and who wrote it', Icon: Clock },
  { key: 'tags', label: 'Tags & References', short: 'Tags', hint: 'Tags in this note and notes that link to it', Icon: Tag },
  // Agents belong here rather than in a panel of their own: this is already the
  // right-hand column, and a separate surface for one button was one too many.
  { key: 'agent', label: 'Agents', short: 'Agent', hint: 'Give an agent a token, or take one back', Icon: Bot },
];

export default function HelperView({
  content,
  editorRef,
  activeTab: controlledTab,
  onTabChange,
  noteId,
  storage,
  notes,
  currentNoteId,
  onNoteClick,
  onTagClick,
  onRestoreContent,
  onHide,
  agentsEnabled = true,
  onSignInToUseAgents,
  // The thread is assembled by the shell, which owns the note's revision and the
  // save path: a proposal is applied through the same guarded write as typing,
  // so it cannot jump a change the agent never saw.
  threadProps = null,
  onNotice,
}) {
  const [internalTab, setInternalTab] = useState('toc');
  const requestedTab = controlledTab !== undefined ? controlledTab : internalTab;
  // A stored tab that no longer exists ('toc', before Contents was cut) must fall
  // back to the first tab, not to a name that is not in the list: that left every
  // tab unselected and no panel named.
  const activeTab = HELPER_TABS.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : HELPER_TABS[0].key;

  const setActiveTab = (tab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  // A tablist is one tab stop, not four: the selected tab is the only one the
  // Tab key reaches and the arrow keys move between them (WAI-ARIA's tabs
  // pattern). Four tabbable tabs made a keyboard user press Tab four times to
  // get past the panel, and the arrow keys did nothing at all (2026-10-15).
  const tabRefs = useRef({});

  const onTabKeyDown = (event) => {
    // Arrow keys walk from the tab that has focus, not from the tab that is
    // selected. They are the same thing when the tablist is used the usual way,
    // but focusing a tab without selecting it (a click elsewhere, or a test that
    // starts from a different panel) made the next ArrowRight select the focused
    // tab instead of moving past it — one press that did nothing visible.
    const focusedKey = Object.entries(tabRefs.current).find(
      ([, element]) => element && element === document.activeElement
    )?.[0];
    const from = focusedKey || activeTab;
    const index = HELPER_TABS.findIndex((tab) => tab.key === from);
    let nextKey = null;
    if (event.key === 'ArrowRight') {
      nextKey = HELPER_TABS[(index + 1) % HELPER_TABS.length].key;
    } else if (event.key === 'ArrowLeft') {
      nextKey = HELPER_TABS[(index - 1 + HELPER_TABS.length) % HELPER_TABS.length].key;
    } else if (event.key === 'Home') {
      nextKey = HELPER_TABS[0].key;
    } else if (event.key === 'End') {
      nextKey = HELPER_TABS[HELPER_TABS.length - 1].key;
    }
    if (!nextKey) return;
    event.preventDefault();
    setActiveTab(nextKey);
    tabRefs.current[nextKey]?.focus();
  };


  const tabClass = (tabName) =>
    `flex min-h-10 flex-1 items-center justify-center min-w-[88px] rounded-lg px-4 py-2.5 text-xs font-medium transition-[transform,background-color,color,box-shadow,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96] ${
      activeTab === tabName
        ? 'border border-accent-500/20 bg-gray-700/50 text-gray-100 shadow-soft'
        : 'border border-transparent text-gray-300 hover:bg-gray-800/50 hover:text-gray-100'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1rem] bg-gray-900/20">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/50">
        <div className="text-balance text-sm font-semibold text-gray-200">Helper View</div>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex min-h-10 items-center rounded-lg border border-transparent px-3 text-[11px] font-medium uppercase tracking-wide text-gray-400 transition-[transform,background-color,color,border-color] duration-200 hover:border-gray-700/60 hover:bg-gray-800/50 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96]"
            aria-label="Hide helper view"
          >
            Hide
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Helper views"
        className="flex gap-1 border-b border-gray-700/50 px-2 py-2 overflow-x-auto"
      >
        {HELPER_TABS.map(({ key, label, short, hint, Icon }) => (
          // No Tooltip component here: a tablist may only contain tabs, and a
          // wrapper span between the two breaks that (and takes the arrow keys'
          // target with it). A native title is enough for a tab that already
          // shows its own name.
          <button
            key={key}
            title={hint}
            ref={(element) => {
              tabRefs.current[key] = element;
            }}
            id={`helper-tab-${key}`}
            onClick={() => setActiveTab(key)}
            onKeyDown={onTabKeyDown}
            className={tabClass(key)}
            aria-label={label}
            aria-selected={activeTab === key}
            // Only the selected tab names a panel: the other two panels are
            // not in the DOM, and an aria-controls pointing at nothing is a
            // dangling reference. The panel names its tab back.
            aria-controls={activeTab === key ? `helper-panel-${key}` : undefined}
            tabIndex={activeTab === key ? 0 : -1}
            role="tab"
          >
            <div className="flex items-center justify-center gap-1.5">
              <Icon className="w-3.5 h-3.5 translate-y-px" />
              <span>{short}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        id={`helper-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`helper-tab-${activeTab}`}
        className="flex-1 overflow-hidden flex flex-col"
      >
        {activeTab === 'history' ? (
          <NoteHistory
            noteId={noteId}
            content={content}
            storage={storage}
            onRestore={onRestoreContent}
            editorRef={editorRef}
          />
        ) : activeTab === 'tags' ? (
          <TagsReferences
            content={content}
            notes={notes}
            currentNoteId={currentNoteId}
            onNoteClick={onNoteClick}
            onTagClick={onTagClick}
          />
        ) : activeTab === 'thread' ? (
          <NoteThread {...(threadProps || {})} onNotice={onNotice} />
        ) : (
          <AgentTab agentsEnabled={agentsEnabled} onSignInToUseAgents={onSignInToUseAgents} />
        )}
      </div>
    </div>
  );
}
