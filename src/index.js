import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// Pixel Icon Library (CC BY 4.0 — attribution in DesignSystem/Fonts.js)
// Provides the <i class="hn hn-{name}"> icon font used by DSIcons

import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
