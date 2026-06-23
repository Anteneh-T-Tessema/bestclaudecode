const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])

export function isImageFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return false
  return IMAGE_EXTS.has(filePath.slice(dot).toLowerCase())
}
