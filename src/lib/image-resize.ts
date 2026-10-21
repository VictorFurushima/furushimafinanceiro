/**
 * Redução de prints no navegador antes do envio para a leitura por IA.
 * Limita o lado menor (legibilidade de prints longos) e o total de pixels (fotos de câmera),
 * porque a IA cobra a imagem por blocos: mais pixels custam mais sem melhorar a leitura.
 */
export const OCR_MAX_SHORT_SIDE = 1600;
export const OCR_MAX_PIXELS = 6_000_000;

/** Fator de escala para caber nos limites; 1 quando a imagem já é pequena. */
export function ocrScale(width: number, height: number) {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(
    1,
    OCR_MAX_SHORT_SIDE / Math.min(width, height),
    Math.sqrt(OCR_MAX_PIXELS / (width * height)),
  );
}

/** Devolve o arquivo original quando a redução não compensa ou o navegador não suporta. */
export async function shrinkImageForOcr(file: File): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = ocrScale(bitmap.width, bitmap.height);
    // Ganho pequeno não justifica recodificar a imagem.
    if (scale > 0.9) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, 0.9),
    );
    // Sem codificador para o formato (ex.: WebP em alguns navegadores), o canvas troca o tipo.
    if (!blob || blob.type !== file.type || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
