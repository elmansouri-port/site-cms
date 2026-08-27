import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ToastProvider } from './lib/toast.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ConfirmProvider, TooltipProvider } from './components/ui/index.js';
import './styles.css';

/*
 * The provider order is load-bearing in one place: the outer ErrorBoundary sits
 * inside ThemeProvider so that a failure in the shell still renders in the
 * editor's chosen theme, and outside everything else so that it catches one.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <TooltipProvider delayDuration={250}>
          <BrowserRouter basename="/admin">
            <ToastProvider>
              <ConfirmProvider>
                <AuthProvider>
                  <App />
                </AuthProvider>
              </ConfirmProvider>
            </ToastProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
