import React, { useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { X, FileText, FileCode, Printer, Download, Check } from 'lucide-react';
import { markdownToHtml } from '../utils/markdown';
import { copyTextToClipboard } from '../utils/clipboard';
import { noticeText } from '../services/notices';
import { useFocusTrap } from '../hooks/useFocusTrap';

const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default function ExportModal({
  isOpen,
  onClose,
  content = '',
  noteTitle = 'Untitled',
  onNotice,
}) {
  const [exported, setExported] = useState(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef(null);
  const closeButtonRef = useRef(null);

  // Escape, Tab that stays inside the dialog, and the caret going back to the
  // Export button when it closes — all of it lives in the hook now (2026-10-15).
  // Without the trap, Tab walked out of a dialog that says aria-modal="true".
  useFocusTrap(containerRef, isOpen, { onClose, initialFocusRef: closeButtonRef });

  if (!isOpen) return null;

  const getHtmlContent = () => markdownToHtml(content);

  const getMarkdownContent = () => content;

  const getPlainText = () => {
    const doc = new DOMParser().parseFromString(getHtmlContent(), 'text/html');
    return doc.body.textContent || '';
  };

  const handleExportMarkdown = () => {
    const markdown = getMarkdownContent();
    downloadFile(markdown, `${noteTitle}.md`, 'text/markdown');
    setExported('markdown');
    setTimeout(() => setExported(null), 2000);
  };

  const handleExportHtml = () => {
    const html = DOMPurify.sanitize(getHtmlContent());
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(noteTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #333; }
    h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
    p { margin: 0.5em 0; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
    blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
    ul, ol { padding-left: 1.5rem; }
    img { max-width: 100%; height: auto; }
    a { color: #0066cc; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
    downloadFile(fullHtml, `${noteTitle}.html`, 'text/html');
    setExported('html');
    setTimeout(() => setExported(null), 2000);
  };

  const handleExportTxt = () => {
    const text = getPlainText();
    downloadFile(text, `${noteTitle}.txt`, 'text/plain');
    setExported('txt');
    setTimeout(() => setExported(null), 2000);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      // The reader gets told, not only the console: a click that does nothing
      // is the failure this notice exists for.
      console.warn('Please allow popups to use the print feature.');
      onNotice?.('printBlocked');
      return;
    }
    const html = DOMPurify.sanitize(getHtmlContent());
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${escapeHtml(noteTitle)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
          h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
          p { margin: 0.5em 0; }
          pre { background: #f4f4f4; padding: 1rem; border-radius: 4px; white-space: pre-wrap; }
          code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; }
          blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
          ul, ol { padding-left: 1.5rem; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 2rem; padding: 1rem; background: #f0f0f0; border-radius: 4px;">
          <button onclick="window.print()" style="padding: 0.5rem 1rem; cursor: pointer;">Print / Save as PDF</button>
          <span style="margin-left: 1rem; color: #666;">Choose "Save as PDF" in the print dialog to keep a PDF.</span>
        </div>
        ${html}
      </body>
      </html>
    `);
    printWindow.document.close();
    setExported('print');
    setTimeout(() => setExported(null), 2000);
  };

  const handleCopyMarkdown = async () => {
    const markdown = getMarkdownContent();
    const copied = await copyTextToClipboard(markdown);
    if (!copied) {
      // A refused clipboard used to end in the console and nowhere else, so the
      // reader pressed the button and nothing happened.
      console.warn('Copy failed: the browser refused clipboard access.');
      onNotice?.('copyFailed');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportOptions = [
    {
      id: 'markdown',
      label: 'Markdown',
      description: 'Export as .md file',
      icon: FileText,
      action: handleExportMarkdown,
      color: 'text-gray-400',
      bgColor: 'bg-white/5',
    },
    {
      id: 'html',
      label: 'HTML',
      description: 'Export as .html file',
      icon: FileCode,
      action: handleExportHtml,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
    },
    {
      id: 'txt',
      label: 'Plain Text',
      description: 'Export as .txt file',
      icon: FileText,
      action: handleExportTxt,
      color: 'text-gray-400',
      bgColor: 'bg-gray-500/10',
    },
    {
      id: 'print',
      label: 'Print / PDF',
      description: 'Open print dialog',
      icon: Printer,
      action: handlePrint,
      color: 'text-gray-400',
      bgColor: 'bg-white/5',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Export note"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-100">
            Export note
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close export dialog"
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Export Options */}
        <div className="p-6 space-y-3">
          {exportOptions.map((option) => {
            const Icon = option.icon;
            const isExported = exported === option.id;

            return (
              <button
                key={option.id}
                onClick={option.action}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors group"
              >
                <div className={`p-3 rounded-lg ${option.bgColor} ${option.color}`}>
                  <Icon size={24} />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {isExported ? (
                      <span className="flex items-center gap-2">
                        <Check size={16} className="text-green-500" />
                        {noticeText('exported')}
                      </span>
                    ) : (
                      option.label
                    )}
                  </div>
                  <div className="text-sm text-gray-400">
                    {option.description}
                  </div>
                </div>
                <Download
                  size={18}
                  className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors"
                />
              </button>
            );
          })}
        </div>

        {/* Copy Markdown Button */}
        <div className="px-6 pb-6">
          <button
            onClick={handleCopyMarkdown}
            className="w-full py-3 px-4 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check size={18} className="text-green-500" />
                {noticeText('copied')}
              </>
            ) : (
              <>
                <FileText size={18} />
                Copy as Markdown
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
