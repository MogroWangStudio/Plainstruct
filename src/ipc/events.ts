/** 事件名常量 -- 与 src-tauri/src/events.rs 逐行镜像,防止漂移 */

export const Events = {
  SyncProgress: "plainstruct://sync-progress",
  UpdateProgress: "plainstruct://update-progress",
  PublishLog: "plainstruct://publish-log",
  CloseRequested: "plainstruct://close-requested",
  PreviewRebuilt: "plainstruct://preview-rebuilt",
} as const;

export type SyncProgressEvent = typeof Events.SyncProgress;

/** 浏览器 mock 事件总线:mock 层经 mockEmit 触发,驱动 listen 注册的处理器 */
type MockHandler = (payload: unknown) => void;
const mockListeners = new Map<string, Set<MockHandler>>();

export function mockEmit<T>(event: string, payload: T): void {
  mockListeners.get(event)?.forEach((h) => h(payload));
}

/** 监听全局广播事件,返回取消函数;浏览器环境走 mock 事件总线 */
export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    if (!mockListeners.has(event)) mockListeners.set(event, new Set());
    const set = mockListeners.get(event)!;
    const wrapped = handler as MockHandler;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  const unlisten = await tauriListen<T>(event, (e) => handler(e.payload));
  return () => void unlisten();
}
