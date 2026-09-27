/** 事件名常量 -- 与 src-tauri/src/events.rs 逐行镜像,防止漂移 */

export const Events = {
  SyncProgress: "plainstruct://sync-progress",
  UpdateProgress: "plainstruct://update-progress",
  PublishLog: "plainstruct://publish-log",
} as const;

export type SyncProgressEvent = typeof Events.SyncProgress;

/** 监听全局广播事件,返回取消函数;浏览器环境为空操作 */
export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window)) return () => undefined;
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  const unlisten = await tauriListen<T>(event, (e) => handler(e.payload));
  return () => void unlisten();
}
