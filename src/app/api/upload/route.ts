export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { handle, ok, err } from '@/lib/api-helpers';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

export const POST = handle(async (request: Request) => {
  await requireAuth();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return err('No se recibió ningún archivo');
  }

  // Validar tipo de archivo
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return err('Tipo de archivo no permitido. Usa: JPEG, PNG, WebP o GIF');
  }

  // Validar tamaño (máximo 10MB para procesar)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return err('El archivo es demasiado grande. Máximo 10MB');
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // ── Procesar con Sharp ──────────────────────────────────────────
  const isGif = file.type === 'image/gif';
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'products');
  await mkdir(uploadDir, { recursive: true });

  if (isGif) {
    // GIF: solo redimensionar si es muy grande, mantener animación
    const ext = file.name.split('.').pop() ?? 'gif';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    let processed = sharp(buffer, { animated: true });
    const metadata = await processed.metadata();

    // Redimensionar si el ancho excede 800px
    if (metadata.width && metadata.width > 800) {
      processed = processed.resize(800, undefined, { fit: 'inside', withoutEnlargement: true });
    }

    await writeFile(path.join(uploadDir, filename), await processed.toBuffer());

    return ok({
      url: `/uploads/products/${filename}`,
      filename,
      original_size: file.size,
    });
  }

  // JPEG / PNG / WebP → redimensionar + convertir a WebP con compresión
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;

  let pipeline = sharp(buffer);
  const metadata = await pipeline.metadata();

  // Redimensionar: máximo 800px de ancho, mantener aspect ratio
  if (metadata.width && metadata.width > 800) {
    pipeline = pipeline.resize(800, undefined, {
      fit: 'inside',
      withoutEnlargement: true,
      // Usar kernel sharp para mejor calidad al reducir
      kernel: sharp.kernel.lanczos3,
    });
  }

  // Convertir a WebP con calidad 80 (balance calidad/tamaño)
  const processedBuffer = await pipeline
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  await writeFile(path.join(uploadDir, filename), processedBuffer);

  const savedRatio = file.size > 0 ? Math.max(0, ((1 - processedBuffer.length / file.size) * 100)).toFixed(0) : '0';

  return ok({
    url: `/uploads/products/${filename}`,
    filename,
    original_size: file.size,
    compressed_size: processedBuffer.length,
    saved_percent: `${savedRatio}%`,
  });
});
