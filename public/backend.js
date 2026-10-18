// Escolhe de onde vem os dados: servidor Node proprio (desenvolvimento) ou Supabase (versao publicada).
import { CONFIG } from './config.js';
import { createNodeBackend } from './backend-node.js';

export async function createBackend() {
  if (CONFIG.backend === 'supabase') {
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return { kind: 'unconfigured' };
    const { createSupabaseBackend } = await import('./backend-supabase.js');
    return createSupabaseBackend(CONFIG);
  }
  return createNodeBackend();
}
