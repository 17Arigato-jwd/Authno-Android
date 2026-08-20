/**
 * extensionStorage.js — one extension's private key/value store.
 *
 * Lifted out of extensionSandbox.js so both runners can use the same one. That
 * matters more than it looks: storage keyed differently per runner would mean
 * an extension losing its own data the moment it was ported to v2, which is a
 * migration nobody asked for and nobody would notice until their settings were
 * gone.
 *
 * Namespaced by extension id, and deliberately not where grants live — an
 * extension that could write its own grants would not need to ask for anything.
 *
 * Every operation is best-effort. localStorage throws under quota pressure and
 * in private browsing, and an extension losing a preference is not a reason for
 * the app to stop.
 */

const ns = (extId) => `__ext_kv_${extId}__`;

export function extStorage(extId) {
  const prefix = ns(extId);
  return {
    get: async (k) => { try { return localStorage.getItem(prefix + k); } catch { return null; } },
    set: async (k, v) => {
      try {
        if (v === null || v === undefined) localStorage.removeItem(prefix + k);
        else localStorage.setItem(prefix + k, String(v));
        return true;
      } catch { return false; }
    },
    remove: async (k) => { try { localStorage.removeItem(prefix + k); return true; } catch { return false; } },
    keys: async () => {
      try {
        return Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length));
      } catch { return []; }
    },
  };
}

/** Called on uninstall, so a reinstall does not inherit the old data. */
export function clearExtStorage(extId) {
  const prefix = ns(extId);
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(prefix)) localStorage.removeItem(k);
    }
    return true;
  } catch { return false; }
}
