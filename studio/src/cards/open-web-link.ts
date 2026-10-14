/**
 * 在系统浏览器里打开网页。
 * 桌面版的主进程拒绝一切 window.open（见 electron/main.ts 的 setWindowOpenHandler），
 * 所以点了毫无反应；必须走 window.studio.openExternal。只有普通浏览器里（没有桌面桥）才退回 window.open。
 * 失败时给出提示，不能静默。
 */
export interface OpenWebDeps {
  external?: (url: string) => Promise<unknown>;
  fallbackOpen: (url: string) => void;
  notify: (message: string) => void;
}

export async function openWebLink(href: string, deps: OpenWebDeps): Promise<boolean> {
  try {
    if (deps.external) await deps.external(href);
    else deps.fallbackOpen(href);
    return true;
  } catch (error) {
    deps.notify(`打开网页失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
