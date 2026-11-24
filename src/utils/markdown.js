// Cached regex patterns for performance
const REGEX_PATTERNS = {
  // HTML escaping
  ESCAPE_AMP: /&/g,
  ESCAPE_LT: /</g,
  ESCAPE_GT: />/g,
  ESCAPE_QUOT: /"/g,
  ESCAPE_APOS: /'/g,

  // Inline formatting
  LINK: /\[([^\]]+)\]\(([^)]+)\)/g,
  BOLD: /\*\*(.+?)\*\*/g,
  // ITALIC: Match single asterisk (processed after bold, so remaining * are safe)
  // Simple pattern since bold is already processed
  ITALIC: /\*([^*\n]+?)\*/g,
  UNDERLINE: /_(.+?)_/g,
  INLINE_CODE: /`([^`]+)`/g,
  STRIKETHROUGH: /~~(.+?)~~/g,

  // Block-level patterns
  CODE_BLOCK_START: /^```/,
  HORIZONTAL_RULE: /^[-*_]{3,}$/,
  BLOCKQUOTE: /^>\s+/,
  UNORDERED_LIST: /^\s*-\s+/,
  ORDERED_LIST: /^\s*\d+\.\s+/,
  TASK_LIST: /^(\s*)- \[([ x])\]\s+(.+)$/,
  HEADING: /^#{1,6}\s+/,
  HEADING_LEVEL: /^#{1,6}/,
  HEADING_FULL: /^(#{1,6})\s+(.+)$/,

  // HTML parsing
  LANGUAGE_CLASS: /language-(\w+)/,
  LIST_ITEM_UNORDERED: /^-\s/,
  LIST_ITEM_ORDERED: /^\d+\.\s/,

  // Markdown cleanup
  WHITESPACE_NORMALIZE: /[ \t]+/g,
  TRAILING_NEWLINES: /\n+$/,
  LEADING_NEWLINES: /^\n+/,
  MULTIPLE_NEWLINES: /\n{3,}/g,
  DOUBLE_NEWLINE_BETWEEN_TEXT: /([^\n])\n\n([^\n#>\-0-9])/g,
  DOUBLE_NEWLINE_BETWEEN_NONSPECIAL: /([^\n#>\-0-9])\n\n([^\n#>\-0-9])/g,

  // Line splitting
  NEWLINE: /\n/,
};

// A line of markdown with its syntax removed, so the interface shows the words
// rather than the markup: `# Reliability check` is "Reliability check".
const plainFromMarkdownLine = (line = '') =>
  String(line)
    .trim()
    .replace(/^#{1,6}\s+/, '')            // headings
    .replace(/^>\s*/, '')                  // block quotes
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')  // task list items
    .replace(/^([-*+]|\d+[.)])\s+/, '')    // bullets and numbered lists
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links -> link text
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/(\*\*|__)(.*?)\1/g, '$2')    // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')       // italic
    .replace(/~~(.*?)~~/g, '$1')           // strikethrough
    .trim();

// The lines of a note that carry words: no blanks, no rules like ---.
const meaningfulLines = (value = '') =>
  String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^([-*_])\1{2,}$/.test(line));

/**
 * Derive a note title from its markdown source.
 *
 * The sidebar shows the first line of the note, so in a markdown-source
 * notebook it must show the words rather than the syntax.
 */
export const titleFromMarkdown = (value = '', maxLength = 50) => {
  const firstLine = meaningfulLines(value)[0];
  if (!firstLine) return '';
  return plainFromMarkdownLine(firstLine).substring(0, maxLength);
};

/**
 * The line under the title in the note list: the note's own second line of
 * words, with its syntax removed. The first line is already the title, so a
 * one-line note has nothing to add and this returns ''.
 */
export const previewFromMarkdown = (value = '', maxLength = 90) => {
  const line = meaningfulLines(value)[1];
  if (!line) return '';
  return plainFromMarkdownLine(line).substring(0, maxLength);
};

export const escapeHtml = (value = '') =>
  value
    .replace(REGEX_PATTERNS.ESCAPE_AMP, '&amp;')
    .replace(REGEX_PATTERNS.ESCAPE_LT, '&lt;')
    .replace(REGEX_PATTERNS.ESCAPE_GT, '&gt;')
    .replace(REGEX_PATTERNS.ESCAPE_QUOT, '&quot;')
    .replace(REGEX_PATTERNS.ESCAPE_APOS, '&#39;');

export const formatInline = (text = '') => {
  let formatted = escapeHtml(text);
  // Process in order from most specific to least specific to avoid conflicts
  // 1. Links: [text](url) - most specific pattern
  formatted = formatted.replace(
    REGEX_PATTERNS.LINK,
    (match, text, url) => {
      const trimmedUrl = url.trim();
      if (!/^(https?:\/\/|mailto:)/.test(trimmedUrl)) {
        return match;
      }
      return `<a href="${trimmedUrl}" class="text-slate-600 hover:text-slate-800 underline dark:text-slate-400 dark:hover:text-slate-300" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
  );
  // 2. Inline code - process before bold/italic to protect code content
  formatted = formatted.replace(
    REGEX_PATTERNS.INLINE_CODE,
    '<code class="px-1 py-0.5 rounded bg-gray-200 bg-opacity-30 dark:bg-gray-700 dark:bg-opacity-50">$1</code>'
  );
  // 3. Bold - process before italic to avoid conflicts with single asterisks
  formatted = formatted.replace(REGEX_PATTERNS.BOLD, '<strong>$1</strong>');
  // 3.5. Strikethrough (after bold, before italic)
  formatted = formatted.replace(REGEX_PATTERNS.STRIKETHROUGH, '<s>$1</s>');
  // 4. Italic - after bold to avoid matching asterisks that are part of bold
  formatted = formatted.replace(REGEX_PATTERNS.ITALIC, '<em>$1</em>');
  // 5. Underline - last as it uses underscore which is less common
  formatted = formatted.replace(REGEX_PATTERNS.UNDERLINE, '<u>$1</u>');
  return formatted;
};

const preserveTrailingSpaces = (formatted = '') =>
  formatted.endsWith(' ')
    ? formatted.replace(/( +)$/, (match) => '&nbsp;'.repeat(match.length))
    : formatted;

export const renderMarkdown = (value = '') => {
  const lines = value.split(REGEX_PATTERNS.NEWLINE);
  let html = '';
  let inList = false;
  let inOrderedList = false;
  let inTaskList = false;
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLanguage = '';

  lines.forEach((line) => {
    const trimmed = line.trim();

    // Code blocks (fenced)
    if (REGEX_PATTERNS.CODE_BLOCK_START.test(trimmed)) {
      if (inCodeBlock) {
        // End code block
        html += `<pre class="bg-gray-800 dark:bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto my-4 border border-gray-700/50 dark:border-gray-600/50"><code class="language-${escapeHtml(codeBlockLanguage)}">${escapeHtml(codeBlockContent)}</code></pre>`;
        codeBlockContent = '';
        codeBlockLanguage = '';
        inCodeBlock = false;
      } else {
        // Start code block
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (inOrderedList) {
          html += '</ol>';
          inOrderedList = false;
        }
        if (inTaskList) {
          html += '</ul>';
          inTaskList = false;
        }
        codeBlockLanguage = trimmed.replace(REGEX_PATTERNS.CODE_BLOCK_START, '').trim();
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      return;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      if (inOrderedList) {
        html += '</ol>';
        inOrderedList = false;
      }
      if (inTaskList) {
        html += '</ul>';
        inTaskList = false;
      }
      html += '<hr class="my-6 border-gray-300 dark:border-gray-600" />';
      return;
    }

    // Blockquote
    if (REGEX_PATTERNS.BLOCKQUOTE.test(trimmed)) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      if (inOrderedList) {
        html += '</ol>';
        inOrderedList = false;
      }
      if (inTaskList) {
        html += '</ul>';
        inTaskList = false;
      }
      const quoteText = line.replace(REGEX_PATTERNS.BLOCKQUOTE, '');
      html += `<blockquote class="border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-2 my-3 italic text-gray-700 dark:text-gray-300">${preserveTrailingSpaces(formatInline(quoteText))}</blockquote>`;
      return;
    }

    // Task list (must come before regular unordered list)
    if (REGEX_PATTERNS.TASK_LIST.test(line)) {
      const match = line.match(REGEX_PATTERNS.TASK_LIST);
      const indent = match[1].length;
      const checked = match[2] === 'x';
      const text = match[3];

      if (!inTaskList) {
        // Close other lists if open
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (inOrderedList) {
          html += '</ol>';
          inOrderedList = false;
        }
        html += '<ul class="not-prose pl-0 list-none space-y-1 mb-3">';
        inTaskList = true;
      }

      html += `<li class="flex items-start gap-2">
        <input type="checkbox" ${checked ? 'checked' : ''} disabled class="mt-1" />
        <span>${preserveTrailingSpaces(formatInline(text))}</span>
      </li>`;
      return;
    }

    // Unordered list
    if (REGEX_PATTERNS.UNORDERED_LIST.test(line)) {
      if (!inList) {
        if (inOrderedList) {
          html += '</ol>';
          inOrderedList = false;
        }
        if (inTaskList) {
          html += '</ul>';
          inTaskList = false;
        }
        html += "<ul class='list-disc pl-6 space-y-1 mb-3'>";
        inList = true;
      }
      const item = line.replace(REGEX_PATTERNS.UNORDERED_LIST, '');
      html += `<li>${preserveTrailingSpaces(formatInline(item))}</li>`;
      return;
    }

    // Ordered list
    if (REGEX_PATTERNS.ORDERED_LIST.test(line)) {
      if (!inOrderedList) {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (inTaskList) {
          html += '</ul>';
          inTaskList = false;
        }
        html += "<ol class='list-decimal pl-6 space-y-1 mb-3'>";
        inOrderedList = true;
      }
      const item = line.replace(REGEX_PATTERNS.ORDERED_LIST, '');
      html += `<li>${preserveTrailingSpaces(formatInline(item))}</li>`;
      return;
    }

    if (inList) {
      html += '</ul>';
      inList = false;
    }
    if (inOrderedList) {
      html += '</ol>';
      inOrderedList = false;
    }
    if (inTaskList) {
      html += '</ul>';
      inTaskList = false;
    }

    // Headings
    if (REGEX_PATTERNS.HEADING.test(trimmed)) {
      const level = trimmed.match(REGEX_PATTERNS.HEADING_LEVEL)?.[0].length || 1;
      const headingText = line.replace(REGEX_PATTERNS.HEADING, '');
      const sizeClasses = {
        1: 'text-4xl',
        2: 'text-3xl',
        3: 'text-2xl',
        4: 'text-xl',
        5: 'text-lg',
        6: 'text-base',
      };
      html += `<h${level} class='font-display font-bold mt-6 mb-3 ${sizeClasses[level] || 'text-2xl'} tracking-tight'>${preserveTrailingSpaces(formatInline(headingText))}</h${level}>`;
      return;
    }

    // Empty line
    if (!trimmed) {
      html += "<div class='h-4'></div>";
      return;
    }

    // Regular paragraph
    html += `<p class='mb-2 leading-relaxed'>${preserveTrailingSpaces(formatInline(line))}</p>`;
  });

  if (inList) {
    html += '</ul>';
  }
  if (inOrderedList) {
    html += '</ol>';
  }
  if (inTaskList) {
    html += '</ul>';
  }
  if (inCodeBlock) {
    html += `<pre class="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto my-4"><code class="language-${escapeHtml(codeBlockLanguage)}">${escapeHtml(codeBlockContent)}</code></pre>`;
  }

  if (!html.trim()) {
    html = "<p class='text-gray-500'>Start typing to see a live preview.</p>";
  }

  return html;
};

export const extractHeadings = (markdown) => {
  if (!markdown) return [];
  const lines = markdown.split(REGEX_PATTERNS.NEWLINE);
  const headings = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(REGEX_PATTERNS.HEADING_FULL);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      headings.push({ level, text, lineNumber: index });
    }
  });

  return headings;
};

// Convert HTML to Markdown for storage
export const htmlToMarkdown = (html) => {
  if (!html || html === '<div><br></div>' || html === '<br>') {
    return '';
  }

  // Use DOMParser instead of innerHTML for security (prevents XSS)
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tempDiv = doc.body;

  const convertNode = (node, isLast = false, nextSibling = null, prevSibling = null) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Preserve text content exactly as-is to maintain character order
      // Replace non-breaking spaces with regular spaces for markdown compatibility
      let text = node.textContent || '';
      // Convert &nbsp; entities to regular spaces (they might be in textContent as \u00A0)
      text = text.replace(/\u00A0/g, ' ');
      // CRITICAL: Preserve all spaces, including trailing spaces
      // Don't trim or normalize - spaces are important for user content
      return text;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName?.toLowerCase();
      // Use Array.from to ensure proper order preservation of child nodes
      const childNodes = Array.from(node.childNodes);
      // Process children in order and join to preserve character sequence
      // IMPORTANT: Join with empty string to preserve exact spacing from HTML
      const children = childNodes
        .map((child, idx, arr) =>
          convertNode(child, idx === arr.length - 1, arr[idx + 1] || null, arr[idx - 1] || null)
        )
        .join('');

      switch (tagName) {
        case 'strong':
        case 'b':
          return `**${children}**`;
        case 'em':
        case 'i':
          return `*${children}*`;
        case 'u':
          return `_${children}_`;
        case 's':
        case 'del':
        case 'strike':
          return `~~${children}~~`;
        case 'code':
          return `\`${children}\``;
        case 'a': {
          const href = node.getAttribute('href') || '';
          return `[${children}](${href})`;
        }
        case 'blockquote':
          return `> ${children}\n\n`;
        case 'pre': {
          const codeNode = node.querySelector('code');
          if (codeNode) {
            const lang = codeNode.className.match(REGEX_PATTERNS.LANGUAGE_CLASS)?.[1] || '';
            return `\`\`\`${lang}\n${codeNode.textContent}\n\`\`\`\n\n`;
          }
          return children;
        }
        case 'hr':
          return '\n---\n\n';
        case 'br':
          // Only add newline if not already at end of content
          return '\n';
        case 'p':
          // Only add double newline if paragraph has content
          if (!children.trim()) {
            return '';
          }
          return children + '\n\n';
        case 'div': {
          // Check if it's an empty div (just <br> or whitespace)
          const isEmptyDiv =
            node.innerHTML === '<br>' ||
            node.innerHTML.trim() === '' ||
            (node.children.length === 0 && !node.textContent?.trim());

          if (isEmptyDiv) {
            // Check if this empty div is between two content divs
            // If so, skip it entirely to avoid creating double newlines
            const nextIsContentDiv =
              nextSibling &&
              nextSibling.nodeType === Node.ELEMENT_NODE &&
              nextSibling.tagName?.toLowerCase() === 'div' &&
              nextSibling.textContent?.trim() &&
              nextSibling.innerHTML !== '<br>';
            const prevIsContentDiv =
              prevSibling &&
              prevSibling.nodeType === Node.ELEMENT_NODE &&
              prevSibling.tagName?.toLowerCase() === 'div' &&
              prevSibling.textContent?.trim() &&
              prevSibling.innerHTML !== '<br>';

            // If empty div is between two content divs, skip it
            if (prevIsContentDiv && nextIsContentDiv) {
              return '';
            }
            // Otherwise, treat it as a single newline (for intentional spacing)
            return '\n';
          }

          // Only add newline if there's actual content
          const hasContent = children.trim() && children.trim() !== '<br>';
          if (hasContent) {
            // Check if next sibling is an empty div - if so, don't add newline here
            // (the empty div will handle spacing)
            const nextIsEmptyDiv =
              nextSibling &&
              nextSibling.nodeType === Node.ELEMENT_NODE &&
              nextSibling.tagName?.toLowerCase() === 'div' &&
              (nextSibling.innerHTML === '<br>' || nextSibling.innerHTML.trim() === '');

            if (nextIsEmptyDiv) {
              // Next is empty div, so don't add newline here
              return children;
            }

            // Check if next sibling is also a content div - if so, only add single newline
            const nextIsContentDiv =
              nextSibling &&
              nextSibling.nodeType === Node.ELEMENT_NODE &&
              nextSibling.tagName?.toLowerCase() === 'div' &&
              nextSibling.textContent?.trim() &&
              nextSibling.innerHTML !== '<br>';

            if (nextIsContentDiv) {
              // Next sibling is also a content div, so just add single newline
              return children + '\n';
            } else {
              // This is the last content div or next is something else, add single newline
              return children + '\n';
            }
          }
          return '';
        }
        case 'li': {
          const parent = node.parentElement;
          if (parent?.tagName?.toLowerCase() === 'ol') {
            const index = Array.from(parent.children).indexOf(node) + 1;
            return `${index}. ${children}\n`;
          }
          return `- ${children}\n`;
        }
        case 'ul': {
          // Check if it's a task list via checkbox inputs or TipTap task-item metadata.
          const hasCheckboxes = node.querySelector('input[type="checkbox"]');
          const hasTaskMetadata = node.querySelector('li[data-type="taskItem"], li[data-checked]');
          if (hasCheckboxes || hasTaskMetadata) {
            const items = Array.from(node.querySelectorAll('li'));
            return (
              items
                .map((li) => {
                  const checkbox = li.querySelector('input[type="checkbox"]');
                  const checkedAttribute = li.getAttribute('data-checked');
                  const checked = checkedAttribute === 'true' || checkbox?.checked ? 'x' : ' ';
                  const labelContent =
                    li.querySelector('label > span') ||
                    li.querySelector('label span') ||
                    li.querySelector('span');
                  const text = labelContent
                    ? convertNode(labelContent).trim()
                    : convertNode(li)
                        .replace(/^- \[[ x]\]\s*/, '')
                        .trim();
                  return `- [${checked}] ${text}`;
                })
                .join('\n') + '\n\n'
            );
          }
          // Regular unordered list - existing logic
          return children;
        }
        case 'ol':
          return children;
        case 'h1':
          return `# ${children}\n\n`;
        case 'h2':
          return `## ${children}\n\n`;
        case 'h3':
          return `### ${children}\n\n`;
        case 'h4':
          return `#### ${children}\n\n`;
        case 'h5':
          return `##### ${children}\n\n`;
        case 'h6':
          return `###### ${children}\n\n`;
        default:
          return children;
      }
    }

    return '';
  };

  // Process nodes with awareness of siblings to avoid double newlines
  const childNodes = Array.from(tempDiv.childNodes);
  let markdown = childNodes
    .map((node, idx) => {
      const nextSibling = childNodes[idx + 1] || null;
      const prevSibling = childNodes[idx - 1] || null;
      return convertNode(node, idx === childNodes.length - 1, nextSibling, prevSibling);
    })
    .join('');

  // Clean up extra newlines
  // NOTE: We do NOT normalize whitespace as it can corrupt content and cause character reordering
  // Preserve all whitespace exactly as it appears in the HTML to maintain text integrity

  // Remove trailing newlines from the end
  markdown = markdown.replace(REGEX_PATTERNS.TRAILING_NEWLINES, '');
  // Remove leading newlines from the start
  markdown = markdown.replace(REGEX_PATTERNS.LEADING_NEWLINES, '');
  // Replace 3+ consecutive newlines with just 2 (for intentional paragraph breaks)
  markdown = markdown.replace(REGEX_PATTERNS.MULTIPLE_NEWLINES, '\n\n');
  // Most important: Remove double newlines between consecutive regular text lines
  // This prevents extra spacing between consecutive paragraphs that were wrapped in divs
  // Pattern: non-empty line, double newline, non-empty line that doesn't start with special chars
  // We want to preserve double newlines after headings (#), blockquotes (>), lists (- or numbers)
  // Also preserve double newlines before headings, blockquotes, and lists
  markdown = markdown.replace(REGEX_PATTERNS.DOUBLE_NEWLINE_BETWEEN_TEXT, '$1\n$2');
  // Additional cleanup: remove double newlines that appear between any two non-special lines
  // This catches cases where we have: text\n\nmore text (should be text\nmore text)
  markdown = markdown.replace(REGEX_PATTERNS.DOUBLE_NEWLINE_BETWEEN_NONSPECIAL, '$1\n$2');

  return markdown;
};

// Convert Markdown to HTML for contentEditable display
export const markdownToHtml = (markdown) => {
  if (!markdown) return '';

  const lines = markdown.split(REGEX_PATTERNS.NEWLINE);
  let html = '';
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLanguage = '';
  let lastWasEmpty = false;
  let inTaskList = false;
  let inUnorderedList = false;
  let inOrderedList = false;

  const closeOpenLists = () => {
    if (inUnorderedList) {
      html += '</ul>';
      inUnorderedList = false;
    }
    if (inOrderedList) {
      html += '</ol>';
      inOrderedList = false;
    }
    if (inTaskList) {
      html += '</ul>';
      inTaskList = false;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    // Code blocks
    if (REGEX_PATTERNS.CODE_BLOCK_START.test(trimmed)) {
      if (inCodeBlock) {
        html += `<pre><code class="language-${escapeHtml(codeBlockLanguage)}">${escapeHtml(codeBlockContent)}</code></pre>`;
        codeBlockContent = '';
        codeBlockLanguage = '';
        inCodeBlock = false;
        lastWasEmpty = false;
      } else {
        closeOpenLists();
        codeBlockLanguage = trimmed.replace(REGEX_PATTERNS.CODE_BLOCK_START, '').trim();
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      return;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeOpenLists();
      html += '<hr />';
      lastWasEmpty = false;
      return;
    }

    // Blockquote
    if (REGEX_PATTERNS.BLOCKQUOTE.test(trimmed)) {
      closeOpenLists();
      const quoteText = line.replace(REGEX_PATTERNS.BLOCKQUOTE, '');
      html += `<blockquote>${preserveTrailingSpaces(formatInline(quoteText))}</blockquote>`;
      lastWasEmpty = false;
      return;
    }

    // Task list (must come before regular unordered list)
    if (REGEX_PATTERNS.TASK_LIST.test(line)) {
      const match = line.match(REGEX_PATTERNS.TASK_LIST);
      const checked = match[2] === 'x';
      const text = match[3];

      // Close other list types if open
      if (inUnorderedList) {
        html += '</ul>';
        inUnorderedList = false;
      }
      if (inOrderedList) {
        html += '</ol>';
        inOrderedList = false;
      }

      if (!inTaskList) {
        html += '<ul data-type="taskList">';
        inTaskList = true;
      }

      html += `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox" ${checked ? 'checked' : ''}><span>${preserveTrailingSpaces(formatInline(text))}</span></label></li>`;
      lastWasEmpty = false;
      return;
    }

    // Unordered list
    if (REGEX_PATTERNS.UNORDERED_LIST.test(line)) {
      // Close other list types if open
      if (inOrderedList) {
        html += '</ol>';
        inOrderedList = false;
      }
      if (inTaskList) {
        html += '</ul>';
        inTaskList = false;
      }

      if (!inUnorderedList) {
        html += '<ul>';
        inUnorderedList = true;
      }

      const item = line.replace(REGEX_PATTERNS.UNORDERED_LIST, '');
      html += `<li>${preserveTrailingSpaces(formatInline(item))}</li>`;
      lastWasEmpty = false;
      return;
    }

    // Ordered list
    if (REGEX_PATTERNS.ORDERED_LIST.test(line)) {
      // Close other list types if open
      if (inUnorderedList) {
        html += '</ul>';
        inUnorderedList = false;
      }
      if (inTaskList) {
        html += '</ul>';
        inTaskList = false;
      }

      if (!inOrderedList) {
        html += '<ol>';
        inOrderedList = true;
      }

      const item = line.replace(REGEX_PATTERNS.ORDERED_LIST, '');
      html += `<li>${preserveTrailingSpaces(formatInline(item))}</li>`;
      lastWasEmpty = false;
      return;
    }

    // Close open lists when we encounter a non-list line
    closeOpenLists();

    // Headings
    if (REGEX_PATTERNS.HEADING.test(trimmed)) {
      const level = trimmed.match(REGEX_PATTERNS.HEADING_LEVEL)?.[0].length || 1;
      const headingText = line.replace(REGEX_PATTERNS.HEADING, '');
      html += `<h${level}>${preserveTrailingSpaces(formatInline(headingText))}</h${level}>`;
      lastWasEmpty = false;
    }
    // Empty line - skip to avoid extra spacing
    else if (!trimmed) {
      // Skip empty lines entirely to prevent extra spacing
      lastWasEmpty = true;
    }
    // Regular paragraph
    else {
      const formatted = formatInline(line);

      html += `<div>${preserveTrailingSpaces(formatted)}</div>`;
      lastWasEmpty = false;
    }
  });

  if (inCodeBlock) {
    html += `<pre><code class="language-${escapeHtml(codeBlockLanguage)}">${escapeHtml(codeBlockContent)}</code></pre>`;
  }

  // Close any remaining open lists
  closeOpenLists();

  const result = html || '<div><br></div>';
  return result;
};
