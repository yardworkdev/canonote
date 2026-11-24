import { supabaseAuth } from '../services/supabase';

export const getUserSessionAuthHeaders = async (headers = {}) => {
  const nextHeaders = { ...headers };
  const session = await supabaseAuth.getSession();
  const accessToken = session?.access_token;
  if (accessToken) {
    nextHeaders.Authorization = `Bearer ${accessToken}`;
  }
  return nextHeaders;
};
