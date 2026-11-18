export interface EntityLoadingPorts {
  shapesReady(kind: string, name: string): boolean;
  waitShapes(): Promise<void>;
  paintSkeleton(kind: string, name: string): void;
  resetView(): void;
  loadShapes(): Promise<unknown>;
  syncParts(kind: string, name: string): void;
}

/** 异步名单只在本次页面打开仍存活时改骨架，页面取消权来自路由元素。 */
export function createEntityLoading(ports: EntityLoadingPorts) {
  return async (kind: string, name: string, current: () => boolean): Promise<void> => {
    ports.paintSkeleton(kind, name);
    ports.resetView();
    if (!ports.shapesReady(kind, name)) {
      void ports.waitShapes().then(() => { if (current()) ports.syncParts(kind, name) });
    }
    void ports.loadShapes().then(() => { if (current()) ports.syncParts(kind, name) });
  };
}
