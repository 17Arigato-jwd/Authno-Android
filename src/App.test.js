import { render } from '@testing-library/react';
import App from './App';

// Smoke test: the app mounts (ThemeProvider + providers + shell) without throwing
// and renders its root container. Replaces the stale Create-React-App boilerplate
// that asserted a "learn react" link this app never had.
test('renders the app shell without crashing', () => {
  const { container } = render(<App />);
  expect(container.querySelector('.app-root')).toBeInTheDocument();
});
