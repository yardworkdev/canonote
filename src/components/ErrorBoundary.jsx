import React from 'react';
import { AlertTriangle, RefreshCw, Home, Copy, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors in child component tree and displays
 * a fallback UI instead of crashing the entire app.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Optional: Send to error tracking service
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleRefresh = () => {
    if (window.confirm('Reload the page? Text you have typed is saved first.')) {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (window.confirm('Go back to the notebook? Text you have typed is saved first.')) {
      window.location.href = '/app';
    }
  };

  handleCopyError = async () => {
    const { error, errorInfo } = this.state;
    const errorText = `Error: ${error?.message || 'Unknown error'}

Stack trace:
${error?.stack || 'No stack trace available'}

Component stack:
${errorInfo?.componentStack || 'No component stack available'}

URL: ${window.location.href}
Time: ${new Date().toISOString()}
User Agent: ${navigator.userAgent}`;

    try {
      await navigator.clipboard.writeText(errorText);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (err) {
      console.error('Failed to copy error:', err);
    }
  };

  toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    const { hasError, error, errorInfo, showDetails, copied } = this.state;
    const { children, fallback, level = 'page' } = this.props;

    if (!hasError) {
      return children;
    }

    // Custom fallback provided
    if (fallback) {
      return fallback({ error, errorInfo, reset: this.handleReset });
    }

    // Inline error for component-level boundaries
    if (level === 'component') {
      return (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-red-700 dark:text-red-300" title={error?.message}>
            This part of the notebook stopped
          </span>
          <button
            onClick={this.handleReset}
            className="ml-auto text-red-600 dark:text-red-400 hover:underline"
          >
            Try again
          </button>
        </div>
      );
    }

    // Full page error UI
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                The notebook stopped
              </h1>
              <p className="text-sm text-gray-400">
                Reload the page to start it again. Your saved notes stay where they are.
              </p>
            </div>
          </div>

          {/* What the error said — the fact, not a paraphrase of it. */}
          <div className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">The error said</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 font-mono">
              {error?.message || 'Unknown error'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={this.handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={this.handleRefresh}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={this.handleGoHome}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            >
              <Home className="w-4 h-4" />
            </button>
          </div>

          {/* Details toggle */}
          <button
            onClick={this.toggleDetails}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? 'Hide' : 'Show'} technical details
          </button>

          {/* Details */}
          {showDetails && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={this.handleCopyError}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                >
                  <Copy className="w-3 h-3" />
                  {copied ? 'Copied' : 'Copy error'}
                </button>
              </div>

              {/* Stack trace */}
              <div className="p-3 bg-gray-900 rounded-lg overflow-auto max-h-48">
                <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                  {error?.stack || 'No stack trace available'}
                </pre>
              </div>

              {/* Component stack */}
              {errorInfo?.componentStack && (
                <div className="p-3 bg-gray-900 rounded-lg overflow-auto max-h-32">
                  <p className="text-xs text-gray-400 mb-1">Component Stack:</p>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Help text — the advice the old copy gave here was to clear browser
              data, which is where a local-first notebook keeps the notes. */}
          <p className="text-xs text-center text-gray-400">
            If reloading does not fix it, copy the details below and report them. Clearing your
            browser data would delete notes stored in this browser.
          </p>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
