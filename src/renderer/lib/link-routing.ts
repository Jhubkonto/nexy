/** Link targets that can be opened by the desktop host rather than a browser. */
function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function localPathFromHref(href?: string): string | null {
  if (!href) return null

  if (href.startsWith('file://')) {
    try {
      const url = new URL(href)
      // file:// URLs with a non-empty hostname are UNC paths. Preserve them
      // in a form understood by Windows and by Electron's shell.openPath.
      const pathname = decodePath(url.pathname)
      if (url.hostname) return `\\\\${url.hostname}\\${pathname.replace(/^\/+/, '').replace(/\//g, '\\')}`
      return /^\/[A-Za-z]:[\\/]/.test(pathname) ? pathname.slice(1) : pathname
    } catch {
      return null
    }
  }

  // Markdown parsers turn a Windows path such as `C:/report.pdf` into the
  // root-relative URL `/C:/report.pdf`.  Restore the drive-qualified form
  // before sending it to the desktop process.
  if (/^\/[A-Za-z]:[\\/]/.test(href)) return decodePath(href.slice(1))

  // Markdown commonly contains native paths rather than file:// URLs.
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(href)) return href
  return null
}

export function isExternalHref(href?: string): boolean {
  if (!href) return false
  return /^(?:https?:|mailto:|tel:|ftp:)/i.test(href)
}
