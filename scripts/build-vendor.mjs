// Gera public/vendor/supabase.js: o cliente do Supabase em um unico arquivo (sem depender de CDN, funciona offline).
import { build } from 'esbuild';

await build({
  stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd(), loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  outfile: 'public/vendor/supabase.js',
});
console.log('public/vendor/supabase.js gerado');

