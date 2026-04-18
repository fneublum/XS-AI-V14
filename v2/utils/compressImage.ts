// Phase 3B — Client-side image compression helper. Ported 1:1 from v1.
// Re-encodes as JPEG (or PNG if source is PNG) at the given quality.

export function compressImage(
  file: File,
  maxWidth: number,
  quality: number = 0.7,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new globalThis.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(
          file.type === 'image/png' ? 'image/png' : 'image/jpeg',
          quality,
        ));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}
