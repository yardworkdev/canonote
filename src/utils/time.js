export const formatRelativeTime = (timestamp) => {
  // Validate input
  if (timestamp == null) return '';
  if (typeof timestamp !== 'number') return '';
  if (isNaN(timestamp)) return '';
  if (!isFinite(timestamp)) return '';

  const now = Date.now();
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // If more than 7 days, return absolute date
  if (days > 7) {
    return new Date(timestamp).toLocaleDateString();
  }

  if (diff < 0) {
    // Past time
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else {
    // Future time
    if (seconds < 60) return 'in a moment';
    if (minutes < 60) return `in ${minutes} min`;
    if (hours < 24) return `in ${hours} hr`;
    return `in ${days} day${days > 1 ? 's' : ''}`;
  }
};
