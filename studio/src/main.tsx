import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { CrashScreen } from './shell/RecoveryScreens';
import './styles/index.css';
import { applyTheme, getThemePreference } from './theme';

applyTheme(getThemePreference());

/** Anything the app does not catch ends here: the branded recovery page (§8.2, §9), never a blank window. */
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {message: string}> {
  state = { message: '' };
  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { message: message.trim() || '未知错误' };
  }
  render() { return this.state.message ? <CrashScreen message={this.state.message}/> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
