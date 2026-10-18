// Prepara o projeto Android gerado pelo Capacitor (roda no GitHub Actions, depois de `npx cap add android`):
// permissoes (microfone do afinador, tela ligada) e icones do launcher a partir dos PNGs do site.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
if (!fs.existsSync(manifestPath)) throw new Error(`Nao achei ${manifestPath}. O comando "cap add android" funcionou?`);

// ---- permissoes ----
let manifest = fs.readFileSync(manifestPath, 'utf8');
const wanted = ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'WAKE_LOCK'];
const missing = wanted.filter((p) => !manifest.includes(`android.permission.${p}`));
if (missing.length) {
  if (!/<application[\s>]/.test(manifest)) throw new Error('AndroidManifest.xml sem a tag <application>.');
  const lines = missing.map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  manifest = manifest.replace(/(\n?)([ \t]*)<application[\s>]/, (all, nl, indent) => `\n${lines}\n\n${indent}${all.trimStart()}`);
  fs.writeFileSync(manifestPath, manifest);
}
for (const p of wanted) if (!fs.readFileSync(manifestPath, 'utf8').includes(`android.permission.${p}`)) throw new Error(`Permissao ${p} nao foi adicionada.`);
console.log('Permissoes ok:', wanted.join(', '));

// ---- icones ----
const im = ['magick', 'convert'].find((c) => { try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!im) throw new Error('ImageMagick (magick/convert) nao esta disponivel no runner.');
const res = 'android/app/src/main/res';
const buckets = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
const resize = (src, size, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); execFileSync(im, [src, '-resize', `${size}x${size}`, dest]); };
for (const [bucket, [launcher, foreground]] of Object.entries(buckets)) {
  const dir = `${res}/mipmap-${bucket}`;
  resize('public/icon-512.png', launcher, `${dir}/ic_launcher.png`);
  resize('public/icon-512.png', launcher, `${dir}/ic_launcher_round.png`);
  resize('public/icon-maskable-512.png', foreground, `${dir}/ic_launcher_foreground.png`);
}
fs.mkdirSync(`${res}/values`, { recursive: true });
fs.writeFileSync(`${res}/values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F2933</color>\n</resources>\n');
console.log('Icones ok (', im, ')');
console.log('--- AndroidManifest.xml ---\n' + fs.readFileSync(manifestPath, 'utf8'));
