import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Columns,
  LogOut,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plus,
} from 'lucide-react';
import ToolbarFormatButton from './ToolbarFormatButton';
import ToolbarHeadingDropdown from './ToolbarHeadingDropdown';
import ToolbarIconButton from './ToolbarIconButton';
import Tooltip from './Tooltip';
import ToolbarOverflowMenu from './ToolbarOverflowMenu';
import ThemeSwitcher from './ThemeSwitcher';
import {
  blockControls,
  formatControls,
  listControls,
  noteControls,
  blocksNeedMenu,
} from './toolbar-controls';

const toolbarIconActionClass =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-300 transition-[transform,background-color,color,box-shadow] duration-200 hover:bg-white/10 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96] sm:h-10 sm:w-10 sm:rounded-lg';

const groupClass = 'flex items-center gap-0.5';

const dividerClass = 'w-px h-6 bg-gray-700/50 mx-2.5';

// "Bold (Cmd/Ctrl+B)" — the tooltip names the action and, where one exists, the
// way to reach it without the mouse.
const withHint = (label, hint) => (hint ? `${label} (${hint})` : label);

function Toolbar({
  activeFormats,
  user,
  sessionExpiresAt,
  copied,
  content = '',
  sidebarOpen,
  onToggleSidebar,
  showHelperView,
  onFormat,
  onInsertHeading,
  onInsertBlockquote,
  onInsertCodeBlock,
  onInsertLink,
  onInsertNumberedList,
  onInsertTaskList,
  onInsertHorizontalRule,
  onInsertTable,
  onInsertBulletList,
  onCopy,
  onClear,
  onLogout,
  isLocalMode = false,
  onToggleHelperView,
  onOpenAgents,
  onSignInToUseAgents,
  splitViewEnabled,
  onToggleSplitView,
  onCreateNote,
  onExport,
}) {
  const noteIsEmpty = content.trim() === '';

  const onSelectFor = {
    bullet: onInsertBulletList,
    numbered: onInsertNumberedList,
    task: onInsertTaskList,
    quote: onInsertBlockquote,
    code: onInsertCodeBlock,
    link: onInsertLink,
    rule: onInsertHorizontalRule,
    table: onInsertTable,
    copy: onCopy,
    export: onExport,
    clear: onClear,
  };

  const stateFor = (control) => {
    const disabled = Boolean(control.needsText) && noteIsEmpty;
    return {
      disabled,
      title: `${withHint(control.label, control.hint)}${
        disabled ? ` — ${control.emptyReason}` : ''
      }`,
    };
  };

  const renderIconControl = (control) => {
    const { disabled, title } = stateFor(control);
    return (
      <ToolbarIconButton
        key={control.id}
        icon={control.icon}
        onClick={onSelectFor[control.id]}
        title={title}
        ariaLabel={control.label}
        disabled={disabled}
      />
    );
  };

  const renderNoteControl = (control) => {
    const { disabled, title } = stateFor(control);
    const Icon = control.icon;
    const danger = control.tone === 'danger';
    return (
      <Tooltip key={control.id} label={title}>
      <button
        type="button"
        onClick={onSelectFor[control.id]}
        disabled={disabled}
        className={`${toolbarIconActionClass} hidden sm:inline-flex ${
          danger ? 'hover:text-red-400 focus-visible:ring-red-500' : ''
        } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-transparent`}
        aria-label={control.label}
      >
        <Icon
          className={`w-4 h-4 ${
            control.id === 'copy'
              ? `transition-colors ${copied ? 'text-green-400' : 'text-gray-300'}`
              : ''
          }`}
        />
      </button>
      </Tooltip>
    );
  };

  // The bar cannot hold every control at every width, and a control that is
  // clipped is a control that is gone — the viewport is the wrong question
  // (a 1280 window with the sidebar open has 208px less bar than one without),
  // so the bar measures itself. `blocksInMenu` is the answer: the block controls
  // stay inline while they fit and move into the overflow menu when they do not,
  // and the decision is made from widths that do not depend on it (the scroller
  // without them, plus their measured width), so it cannot flap.
  const scrollerRef = useRef(null);
  const rootRef = useRef(null);
  const inlineBlocksRef = useRef(null);
  const blocksWidthRef = useRef(0);
  const [blocksInMenu, setBlocksInMenu] = useState(false);

  useLayoutEffect(() => {
    // `scrollWidth` is clamped to `clientWidth`, so it cannot say how wide the
    // content would be if it fit — measure the extent of the row instead. That
    // number is honest in both modes, which is what keeps the decision stable.
    const contentExtent = (node) => {
      const first = node.firstElementChild;
      const last = node.lastElementChild;
      if (!first || !last) return 0;
      return last.getBoundingClientRect().right - first.getBoundingClientRect().left;
    };

    const measure = () => {
      const node = scrollerRef.current;
      if (!node || !node.clientWidth) return;

      // The inline copy is present exactly while the controls are inline, and
      // it is the same markup: its width is what the menu would have to hold.
      if (inlineBlocksRef.current) {
        blocksWidthRef.current = inlineBlocksRef.current.offsetWidth + 2;
      }

      const content = contentExtent(node) + (inlineBlocksRef.current ? 0 : blocksWidthRef.current);
      // The scroller reserves 4px on the right (`pr-1`); the rule adds its own.
      setBlocksInMenu(blocksNeedMenu(content, node.clientWidth - 4));
    };

    measure();

    // jsdom has no ResizeObserver; the unit suite renders one static bar.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    if (observer) {
      if (scrollerRef.current) observer.observe(scrollerRef.current);
      if (rootRef.current) observer.observe(rootRef.current);
    }
    window.addEventListener('resize', measure);
    // Web fonts land after the first layout and can change what fits.
    const fontsReady = document.fonts?.ready;
    if (fontsReady) fontsReady.then(measure).catch(() => {});

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const overflowItems = [
    ...(blocksInMenu
      ? blockControls.map((control) => {
          const { disabled, title } = stateFor(control);
          return { ...control, disabled, title, onSelect: onSelectFor[control.id] };
        })
      : []),
    // The note actions need text to act on and the bar drops them below `sm`;
    // they keep their disabled state wherever they are rendered.
    ...noteControls.map((control) => {
      const { disabled, title } = stateFor(control);
      return {
        ...control,
        className: 'sm:hidden',
        disabled,
        title,
        onSelect: onSelectFor[control.id],
      };
    }),
    {
      id: 'split',
      icon: Columns,
      label: splitViewEnabled ? 'Close split view' : 'Split editor',
      className: 'sm:hidden',
      title: splitViewEnabled ? 'Close split view' : 'Split editor side by side',
      onSelect: onToggleSplitView,
    },
    {
      id: 'helper',
      icon: PanelRight,
      label: showHelperView ? 'Hide helper panel' : 'Show helper panel',
      className: 'sm:hidden',
      title: showHelperView ? 'Hide helper panel' : 'Show helper panel (History, Tags, Agents)',
      onSelect: onToggleHelperView,
    },
  ];

  return (
    <div
      ref={rootRef}
      className="sticky top-0 z-10 bg-gray-800/30 border-gray-700/30 border-b px-2 py-2.5 sm:px-3 md:px-5 md:py-3.5 sm:rounded-t-2xl"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div
          ref={scrollerRef}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`${toolbarIconActionClass} ${
              sidebarOpen
                ? 'border border-accent-500/20 bg-accent-600/20 text-accent-300 shadow-soft'
                : 'border border-transparent text-gray-400'
            }`}
            title={
              sidebarOpen ? 'Hide notes sidebar (Cmd/Ctrl+\\)' : 'Show notes sidebar (Cmd/Ctrl+\\)'
            }
            aria-label={sidebarOpen ? 'Hide notes sidebar' : 'Show notes sidebar'}
            aria-pressed={sidebarOpen}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className={dividerClass} aria-hidden="true"></div>

          <div role="group" aria-label="Text formatting" className={groupClass}>
            {formatControls.map((control) => (
              <ToolbarFormatButton
                key={control.id}
                format={control.marker}
                icon={control.icon}
                active={Boolean(activeFormats[control.activeKey])}
                onClick={onFormat}
                title={withHint(control.label, control.hint)}
                ariaLabel={control.label}
                keyshortcuts={control.keyshortcuts}
              />
            ))}
          </div>

          <div role="group" aria-label="Lists" className={groupClass}>
            {listControls.map(renderIconControl)}
          </div>

          <div className={dividerClass} aria-hidden="true"></div>

          <div role="group" aria-label="Blocks" className={groupClass}>
            <ToolbarHeadingDropdown onClick={onInsertHeading} />

            {/* Present exactly while the block controls are inline — this
                element is also what the bar measures to know whether they fit. */}
            {!blocksInMenu && (
              <div ref={inlineBlocksRef} className={groupClass}>
                <div className={dividerClass} aria-hidden="true"></div>
                {blockControls.map(renderIconControl)}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <div role="group" aria-label="Notebook" className={groupClass}>
            <button
              onClick={onCreateNote}
              className={`${toolbarIconActionClass} hover:text-accent-300`}
              title="New note"
              aria-label="Create new note"
            >
              <Plus className="w-4 h-4" />
            </button>
            {/* Agent collaboration needs an account. In device-only mode the button
                stays and says why, rather than disappearing and leaving no way back
                to the sign-in form. */}
            {onSignInToUseAgents && (
              <Tooltip label="Agents need an account — sign in to give one a token">
                <button
                  onClick={onSignInToUseAgents}
                  className={toolbarIconActionClass}
                  aria-label="Sign in to use agents"
                >
                  <MessageSquare className="w-4 h-4 text-gray-500" />
                </button>
              </Tooltip>
            )}
            {!onSignInToUseAgents && onOpenAgents && (
              <Tooltip label="Agents — give an agent a token">
                <button
                  onClick={onOpenAgents}
                  className={toolbarIconActionClass}
                  aria-label="Open agents"
                >
                  <MessageSquare className="w-4 h-4 text-gray-300" />
                </button>
              </Tooltip>
            )}
            <Tooltip label={splitViewEnabled ? 'One editor again' : 'Split editor, two panes'}>
            <button
              onClick={onToggleSplitView}
              className={`${toolbarIconActionClass} hidden sm:inline-flex ${
                splitViewEnabled
                  ? 'border border-accent-500/20 bg-accent-600/20 text-accent-300 shadow-soft'
                  : 'border border-transparent text-gray-400'
              }`}
              aria-label={splitViewEnabled ? 'Close split view' : 'Split editor'}
              aria-pressed={splitViewEnabled}
            >
              <Columns className="w-4 h-4" />
            </button>
            </Tooltip>
          </div>

          <div role="group" aria-label="Note actions" className={groupClass}>
            {noteControls.map(renderNoteControl)}
          </div>

          <div className="hidden sm:block w-px h-6 bg-gray-700/50 mx-0.5" aria-hidden="true"></div>

          <div role="group" aria-label="Panels" className={groupClass}>
            <button
              type="button"
              onClick={onToggleHelperView}
              className={`${toolbarIconActionClass} hidden sm:inline-flex ${
                showHelperView
                  ? 'border border-accent-500/20 bg-accent-600/20 text-accent-300 shadow-soft'
                  : 'border border-transparent text-gray-400'
              }`}
              aria-pressed={showHelperView}
              title={
                showHelperView ? 'Hide helper panel' : 'Show helper panel (History, Tags, Agents)'
              }
              aria-label={showHelperView ? 'Hide helper panel' : 'Show helper panel'}
            >
              <PanelRight className="w-4 h-4" />
            </button>

            <ThemeSwitcher className={toolbarIconActionClass} />
          </div>

          <ToolbarOverflowMenu
            buttonClass={`${toolbarIconActionClass} ${blocksInMenu ? '' : 'sm:hidden'}`}
            items={overflowItems}
          />

          {/* The account cluster belongs to having an account: with none there is
              nobody to show and nothing to sign out of. Where the notes live is
              a status fact, not a toolbar control — it is stated in the status
              row at the foot of the editor (StorageMode). */}
          {!isLocalMode && (
            <>
              <div
                className="hidden sm:block w-px h-6 bg-gray-700/50 mx-0.5"
                aria-hidden="true"
              ></div>

              <div className="hidden min-h-10 items-center gap-1.5 rounded-lg border border-gray-600/50 bg-gray-700/50 px-2 py-1.5 shadow-soft sm:flex">
                <span
                  className="text-xs font-medium max-w-[80px] truncate text-gray-300"
                  title={
                    sessionExpiresAt
                      ? `Session expires ${new Date(sessionExpiresAt).toLocaleString()}`
                      : (user?.username ?? '')
                  }
                >
                  {user?.username ?? ''}
                </span>
                <button
                  onClick={onLogout}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-[transform,background-color,color] duration-200 hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96]"
                  title="Logout"
                  aria-label="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(Toolbar);
