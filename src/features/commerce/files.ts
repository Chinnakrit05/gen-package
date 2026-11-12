export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('อ่านไฟล์ไม่สำเร็จ'))
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'))
    reader.readAsDataURL(file)
  })
}
export function savePrivateFile(file: { name: string; mimeType: string }, base64: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
  const a = document.createElement('a')
  a.href = url; a.download = file.name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function validPrivateFile(file: File): boolean {
  return file.size > 0 && file.size <= 2 * 1024 * 1024 && ['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) && file.name.length <= 120 && !/[\\/\p{Cc}]/u.test(file.name)
}
