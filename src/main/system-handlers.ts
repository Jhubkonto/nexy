import { app, BrowserWindow, dialog, shell } from "electron";
import { existsSync, statSync, writeFileSync } from "fs";
import path from "path";
import { safeHandle } from "./safe-handle";
import { setAutoStartEnabled } from "./app-lifecycle-settings";

export function registerSystemHandlers(): void {
  safeHandle("app:get-version", () => {
    return app.getVersion();
  });

  safeHandle("app:get-runtime-info", () => {
    return { isPackaged: app.isPackaged };
  });

  safeHandle("app:open-path", async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
      return { ok: false, error: 'Only absolute local paths can be opened' };
    }
    if (!existsSync(absolutePath)) return { ok: false, error: 'File or folder not found' };
    // A generated-file link is most useful when it reveals the result to the
    // user.  For folders, open the folder itself; for files, select it in the
    // platform file manager instead of launching it in an arbitrary program.
    if (statSync(absolutePath).isFile()) {
      shell.showItemInFolder(absolutePath);
      return { ok: true };
    }
    const error = await shell.openPath(absolutePath);
    return error ? { ok: false, error } : { ok: true };
  });

  safeHandle(
    "app:save-text-file",
    async (_event, defaultFileName: string, content: string) => {
      const win = BrowserWindow.getAllWindows()[0];
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultFileName,
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "Markdown", extensions: ["md"] },
          { name: "Text", extensions: ["txt"] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, content, "utf-8");
      return result.filePath;
    },
  );

  safeHandle("app:set-auto-start", (_event, enabled: boolean) => {
    setAutoStartEnabled(enabled);
    return true;
  });
}
