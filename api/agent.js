import { handleAgent } from './_lib/agent-handler.js';

export default async function handler(req, res) {
  return handleAgent(req, res);
}
