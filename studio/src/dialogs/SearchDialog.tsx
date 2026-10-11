import { Suspense, type ComponentProps } from 'react';
import { lazySurface } from '../app/lazy-surface';
import type WorkspaceSearchComponent from '../WorkspaceSearch';

// The palette's own module, kept out of the main bundle (CORE-31). It starts loading with this chunk (App preloads the
// chunk when the browser is idle), so by the first Ctrl K it renders at once instead of passing a Suspense fallback.
const workspaceSearch = lazySurface(() => import('../WorkspaceSearch'));
void workspaceSearch.preload().catch(() => { /* Retried on first open; the fallback below shows meanwhile. */ });
const WorkspaceSearch = workspaceSearch.Surface;

export type SearchDialogProps = ComponentProps<typeof WorkspaceSearchComponent>;

/** Mount point for the search & command palette (WorkspaceSearch owns its native <dialog>). */
export default function SearchDialog(props: SearchDialogProps) {
  return (
    <Suspense fallback={<div className="busy-toast" role="status">正在打开搜索…</div>}>
      <WorkspaceSearch {...props}/>
    </Suspense>
  );
}
