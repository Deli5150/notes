import { File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, type LucideIcon } from 'lucide-react'

/** An icon for a file by its type. */
export function fileIcon(mime: string, name = ''): LucideIcon {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return FileImage
  if (mime.startsWith('audio/')) return FileAudio
  if (mime.startsWith('video/')) return FileVideo
  if (/zip|tar|rar|7z|gzip/.test(mime) || ['zip', 'rar', '7z', 'gz'].includes(ext)) return FileArchive
  if (/sheet|excel|csv/.test(mime) || ['xlsx', 'xls', 'csv', 'numbers'].includes(ext)) return FileSpreadsheet
  if (/presentation|powerpoint/.test(mime) || ['pptx', 'ppt', 'key'].includes(ext)) return Presentation
  if (/json|javascript|xml|html/.test(mime) || ['js', 'ts', 'py', 'json', 'html', 'css', 'swift'].includes(ext)) return FileCode
  if (mime.startsWith('text/') || mime === 'application/pdf' || ['doc', 'docx', 'pages', 'rtf', 'md', 'txt'].includes(ext)) return FileText
  return File
}
