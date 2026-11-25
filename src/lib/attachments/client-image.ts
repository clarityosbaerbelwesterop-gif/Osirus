// Photos in every composer (Chat, Bots, Rouge Agent, Code). A phone photo
// arrives as HEIC or a 4–6 MB JPEG, over the 4 MB upload limit; it is sent
// as one image of at most 1600 px on its long side: small enough to upload,
// sharp enough for a model to read text in it. Browser-only module.

/** What the file pickers offer: photos (camera and library) and files. */
export const IMAGE_ACCEPT = "image/*,.heic,.heif";

const MAX_SIDE = 1600;

export function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name)
  );
}

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

async function decode(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    // Older Safari, or a format createImageBitmap does not take: <img>.
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  }
}

/**
 * The photo as it is uploaded: at most 1600 px on the long side, PNG kept
 * as PNG (screenshots: sharp text), everything else as JPEG. A file that is
 * not an image, or that cannot be decoded, is returned unchanged.
 */
export async function normalizeImage(file: File): Promise<File> {
  if (!isImageFile(file)) return file;
  // An animated GIF would lose its frames; a small one stays as it is.
  if (file.type === "image/gif" && file.size < 2_000_000) return file;
  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
    const scale = Math.min(
      1,
      MAX_SIDE / Math.max(decoded.width, decoded.height, 1),
    );
    const png = file.type === "image/png";
    // A small image of an accepted type needs no new encoding.
    if (scale === 1 && (png || file.type === "image/jpeg") && file.size < 3e6)
      return file;
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    if (!png) {
      // JPEG has no transparency: white instead of black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(decoded.source, 0, 0, width, height);
    const type = png ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.85),
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^./\\]+$/, "") || "foto";
    return new File([blob], `${base}.${png ? "png" : "jpg"}`, { type });
  } catch {
    return file;
  } finally {
    decoded?.release();
  }
}
