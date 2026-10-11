import { lazy, useState, type ComponentType } from 'react';

/**
 * A surface (dialog, panel, view) kept out of the main bundle (CORE-31) that still opens at once.
 *
 * React.lazy suspends on its first render even when its module has already arrived, and React 19 then holds the
 * Suspense fallback for about 100 ms before revealing the content (CORE-11 measured it on the panel; it is also why a
 * lazy dialog first showed only its close button, G3). `preload()` fetches the module early (App calls it when the
 * browser is idle); once it is in, `Surface` renders the component directly. The choice is made once per mount, so a
 * surface that started lazily is never swapped for the loaded component (which would remount it and lose its state).
 * Surfaces rendered lazily still need a Suspense boundary above them.
 */
export function lazySurface<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    pending ??= load().then(module => { loaded = module.default; return module; }).catch(error => { pending = null; throw error; });
    return pending;
  };
  const Lazy = lazy(preload) as unknown as ComponentType<P>;
  function Surface(props: P) {
    const [Component] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return <Component {...props} />;
  }
  return { Surface, preload, isLoaded: () => !!loaded };
}
