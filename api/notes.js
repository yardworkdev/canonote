import { handleNotes } from './_lib/notes-handler.js';

export default async function handler(req, res) {
  return handleNotes(req, res);
}
