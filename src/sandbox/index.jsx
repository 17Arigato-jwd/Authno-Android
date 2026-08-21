/**
 * index.jsx — the sandbox host's root.
 *
 * Deliberately short, and deliberately not src/index.js. The app's root pulls
 * in the gate, the onboarding flow, the theme migration, the widget bridge and
 * App.js itself; this pulls in a theme, the extension provider and the host.
 * Everything the sandbox does not import is absent from the bundle rather than
 * merely unreachable in it, which is the property `check:sandbox-bundle`
 * asserts against the built bytes.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, DARK_DEFAULT, injectThemeFonts } from '../theme';
import { injectDesignSystemFonts } from '../DesignSystem';
import { ExtensionProvider } from '../utils/ExtensionContext';
import SandboxHost from './SandboxHost';
import '../index.css';

injectDesignSystemFonts();
injectThemeFonts(DARK_DEFAULT);

/**
 * The provider needs a navigate callback and the host is what knows where to
 * go, so the callback is routed through the window the same way App.js routes
 * it through a ref — one level of indirection, for one circular dependency.
 */
function Root() {
  const onNavigate = React.useCallback((extension, pageId, session) => {
    window.__sandboxNavigate?.(extension, pageId, session);
  }, []);

  return (
    <ThemeProvider initialTheme={DARK_DEFAULT}>
      <ExtensionProvider onNavigate={onNavigate}>
        <SandboxHost />
      </ExtensionProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
