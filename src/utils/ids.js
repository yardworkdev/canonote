export const createNoteId = () => {
  const timestamp = Date.now();
  let random;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    random = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  } else {
    random = Math.random().toString(36).slice(2, 10);
  }
  return `note-${timestamp}-${random}`;
};
