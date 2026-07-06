/**
 * themePicker.js — pick a .thmbk file and install it (U4).
 *
 * On Android, reuses the native AuthnoFilePicker (same one used for .authbook /
 * .extbk). On web/desktop, uses a hidden <input type="file">. Either way it
 * ends by dispatching to installThmbkBytes, so the InstallSheet animation runs.
 */

import { isAndroid } from './platform';
import { installThmbkBytes } from './themeLoader';

function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export async function pickAndInstallThemeFile() {
  if (isAndroid()) {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin('AuthnoFilePicker');
    // pickFile returns { base64 } for the chosen file (any extension).
    const res = await plugin.pickFile?.({ mimeTypes: ['*/*'], extension: 'thmbk' });
    if (res?.base64) return installThmbkBytes(res.base64);
    return null;
  }

  // Web/desktop
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.thmbk,application/octet-stream';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const manifest = await installThmbkBytes(bytesToBase64(buf));
        resolve(manifest);
      } catch (e) { reject(e); }
    };
    input.click();
  });
}
