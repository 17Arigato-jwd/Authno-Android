import { render } from '@testing-library/react';
import App from './App';

// Smoke test: the app mounts (ThemeProvider + providers + shell) without throwing
// and renders its root container. Replaces the stale Create-React-App boilerplate
// that asserted a "learn react" link this app never had.
test('renders the app shell without crashing', () => {
  const { container } = render(<App />);
  // Queried by class rather than by role: the shell is a bare layout div with
  // no accessible name or role of its own, and the roles that do exist belong
  // to whichever screen the gate decides to show. This asserts the outermost
  // element mounted, which is the whole of what a smoke test is for.
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
  expect(container.querySelector('.app-root')).toBeInTheDocument();
});
