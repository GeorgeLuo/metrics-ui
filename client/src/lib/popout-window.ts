export const DEFAULT_POPOUT_WIDTH = 720;
export const DEFAULT_POPOUT_HEIGHT = 420;

type PopoutFeaturesOptions = {
  width?: number;
  height?: number;
  resizable?: boolean;
  scrollbars?: boolean;
};

export function buildPopoutWindowFeatures(options?: PopoutFeaturesOptions): string {
  const width = Number.isFinite(options?.width) ? Math.max(320, Math.floor(options!.width!)) : DEFAULT_POPOUT_WIDTH;
  const height = Number.isFinite(options?.height)
    ? Math.max(240, Math.floor(options!.height!))
    : DEFAULT_POPOUT_HEIGHT;
  const resizable = options?.resizable ?? true;
  const scrollbars = options?.scrollbars ?? false;
  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `resizable=${resizable ? "yes" : "no"}`,
    `scrollbars=${scrollbars ? "yes" : "no"}`,
  ].join(",");
}

