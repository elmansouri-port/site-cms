import { Component } from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Code } from './ui/index.js';

/*
 * The last line of defence.
 *
 * React unmounts the whole tree when a render throws, so without this one bad
 * value in one screen is a blank white page — no sidebar, no way back, and an
 * editor with no idea whether their last save landed. Which is a bad enough
 * afternoon on its own, and a worse one because the obvious next move is to
 * retype the work.
 *
 * So: say what happened, name the screen, and offer the two moves that actually
 * help — reload, or go back to a screen that works. The details are behind a
 * disclosure because the message is for an editor and the stack is for whoever
 * they forward it to.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Left in deliberately: this is the only record of the failure, and a
    // marketing CMS has no session recording to fall back on.
    console.error('[cms] a screen failed to render', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-full items-start justify-center p-6">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <span className="bg-destructive/10 text-destructive flex size-7 items-center justify-center rounded-full">
              <AlertOctagon className="size-4" />
            </span>
            <CardTitle>This screen stopped working</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Nothing you had already saved is affected — the CMS saves on each action rather than on
              leaving a screen. Anything typed and not yet saved is gone.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => window.location.reload()}>Reload this screen</Button>
              <Button variant="outline" onClick={() => { window.location.href = '/admin/'; }}>
                Back to the overview
              </Button>
            </div>

            <details className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium">
                Details, for whoever you forward this to
              </summary>
              <div className="grid gap-2 border-t p-3">
                <Code className="block whitespace-pre-wrap">{String(error.message || error)}</Code>
                <p className="text-muted-foreground text-[11.5px]">
                  {window.location.pathname} · {new Date().toISOString()}
                </p>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    );
  }
}
