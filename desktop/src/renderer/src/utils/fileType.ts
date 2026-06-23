const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])
const MD_EXTS = new Set(['.md', '.mdx', '.markdown'])

function ext(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot === -1 ? '' : filePath.slice(dot).toLowerCase()
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(ext(filePath))
}

export function isMarkdownFile(filePath: string): boolean {
  return MD_EXTS.has(ext(filePath))
}
