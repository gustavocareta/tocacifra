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

// ---- assinatura estavel + versionCode ----
// O Android so atualiza um app "por cima" se o novo APK for assinado com a MESMA chave. A chave fica em TC_KEYSTORE
// (guardada em cache entre as geracoes) e o versionCode sobe a cada geracao.
const gradlePath = 'android/app/build.gradle';
let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('TC_KEYSTORE')) {
  const signing = `    signingConfigs {
        debug {
            storeFile file(System.getenv('TC_KEYSTORE') ?: "\${System.getProperty('user.home')}/.android/debug.keystore")
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
`;
  if (!/\bandroid\s*\{\n/.test(gradle)) throw new Error('build.gradle sem o bloco android { }.');
  gradle = gradle.replace(/\bandroid\s*\{\n/, (m) => m + signing);
}
const code = Number(process.env.GITHUB_RUN_NUMBER) || 1;
if (!/versionCode\s+\d+/.test(gradle)) throw new Error('build.gradle sem versionCode.');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
fs.writeFileSync(gradlePath, gradle);
console.log('Assinatura estavel e versionCode', code, 'ok');

// ---- teclas do pedal ----
// Pedais Bluetooth "digitam" teclas. O MainActivity do Android recebe toda tecla antes do WebView e a repassa para a pagina
// (evento 'tc-nativekey'), assim o pedal funciona mesmo quando o WebView nao entrega o keydown.
const appId = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8')).appId;
const javaDir = path.join('android/app/src/main/java', ...appId.split('.'));
if (!fs.existsSync(path.join(javaDir, 'MainActivity.java'))) throw new Error(`MainActivity.java nao encontrado em ${javaDir}.`);
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package ${appId};

import android.view.InputDevice;
import android.view.KeyEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0
                && code != KeyEvent.KEYCODE_BACK && code != KeyEvent.KEYCODE_HOME
                && code != KeyEvent.KEYCODE_POWER && code != KeyEvent.KEYCODE_APP_SWITCH) {
            try {
                final WebView web = getBridge().getWebView();
                InputDevice dev = event.getDevice();
                String device = dev != null ? dev.getName().replaceAll("[^A-Za-z0-9 _.-]", "") : "";
                final String js = "window.dispatchEvent(new CustomEvent('tc-nativekey',{detail:{code:" + code
                        + ",name:'" + KeyEvent.keyCodeToString(code) + "',device:'" + device + "'}}))";
                web.post(new Runnable() { public void run() { web.evaluateJavascript(js, null); } });
            } catch (Exception ignored) { }
        }
        return super.dispatchKeyEvent(event);
    }
}
`);
console.log('MainActivity com repasse de teclas ok');

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
