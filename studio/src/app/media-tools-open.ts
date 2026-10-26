/** Opens the local-tools dialog. App binds this while it is on screen. */
let openMediaTools = () => {};

export function bindMediaToolsOpener(open: () => void): void {
  openMediaTools = open;
}

export function requestMediaTools(): void {
  openMediaTools();
}
