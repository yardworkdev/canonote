import React, { useMemo } from 'react';
import { Type, Clock, BookOpen } from 'lucide-react';
import { formatLineColumn } from '../utils/cursor';

/**
 * WordCount Component
 * Displays word count, character count, and estimated reading time
 *
 * `cursor` is the caret's `{ line, column }`, or null until the editor has
 * reported one. It is the one number here that is about *where you are* rather
 * than how much you have written, so it sits next to the words and stays
 * visible while it exists — a position hidden behind a hover is not a position.
 */
export default function WordCount({ content, isVisible = true, cursor = null }) {
  const stats = useMemo(() => {
    if (!content) {
      return { words: 0, chars: 0, charsNoSpaces: 0, readingTime: 0 };
    }

    // Strip HTML tags if content is HTML
    const plainText = content.replace(/<[^>]*>/g, ' ');

    // Word count (split by whitespace and filter empty strings)
    const words = plainText
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const wordCount = words.length;

    // Character counts
    const chars = plainText.length;
    const charsNoSpaces = plainText.replace(/\s/g, '').length;

    // Reading time (average 200 words per minute)
    const readingTimeMinutes = Math.ceil(wordCount / 200);

    return {
      words: wordCount,
      chars,
      charsNoSpaces,
      readingTime: readingTimeMinutes,
    };
  }, [content]);

  if (!isVisible) return null;

  // Format reading time nicely
  const formatReadingTime = (minutes) => {
    if (minutes === 0) return '< 1 min';
    if (minutes === 1) return '1 min';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (remainingMins === 0) return `${hours} hr`;
    return `${hours} hr ${remainingMins} min`;
  };

  const position = formatLineColumn(cursor);

  return (
    <div
      className="group flex items-center gap-2 rounded-lg border border-gray-700/50 bg-gray-800/50 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors cursor-default hover:text-gray-300"
      title={`${stats.chars.toLocaleString()} chars · ${formatReadingTime(stats.readingTime)} read`}
    >
      <Type className="w-3.5 h-3.5 opacity-60" />
      <span className="tabular-nums">{stats.words.toLocaleString()} words</span>
      {position ? (
        <span className="tabular-nums text-gray-400" title="Where the caret is">
          · {position}
        </span>
      ) : null}
      <span className="overflow-hidden whitespace-nowrap text-gray-400 opacity-0 max-w-0 transition-[max-width,opacity] duration-200 group-hover:max-w-[200px] group-hover:opacity-100">
        · {stats.chars.toLocaleString()} chars · {formatReadingTime(stats.readingTime)} read
      </span>
    </div>
  );
}
