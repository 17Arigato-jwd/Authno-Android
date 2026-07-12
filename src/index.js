import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// All UI glyphs are lucide-react vectors via DesignSystem/DSIcons — there is no
// icon web-font. Fonts (Silkscreen / JetBrains Mono) load in injectDesignSystemFonts().

import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
