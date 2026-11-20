import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { UploadProductImageResponse } from '@cafeflow/shared';
import { badRequest, notFound } from '../../common/errors';
import { loadConfig } from '../../config/env';

const MAX_BYTES = 400 * 1024;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
type SupportedMime = keyof typeof EXTENSIONS;

/** Magic-byte check: the declared type must match the actual file. */
function signatureMatches(mime: SupportedMime, bytes: Buffer): boolean {
  if (mime === 'image/png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

/**
 * Product photos are written under the same persistent root as the database and
 * backups, so one mounted volume still protects everything. Files are named by
 * a random UUID — never by client input — and served by an explicit route that
 * only reads that folder.
 */
@Injectable()
export class MediaService {
  private readonly directory = join(dirname(loadConfig().databasePath), 'uploads', 'products');

  save(dataUrl: string): UploadProductImageResponse {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!match) {
      throw badRequest('فرمت تصویر باید PNG، JPEG یا WebP باشد.', 'IMAGE_FORMAT');
    }

    const mime = match[1] as SupportedMime;
    const bytes = Buffer.from(match[2]!, 'base64');

    if (bytes.byteLength === 0) throw badRequest('تصویر خالی است.', 'IMAGE_EMPTY');
    if (bytes.byteLength > MAX_BYTES) {
      throw badRequest('حجم تصویر بیش از ۴۰۰ کیلوبایت است.', 'IMAGE_TOO_LARGE');
    }
    if (!signatureMatches(mime, bytes)) {
      throw badRequest('محتوای فایل با فرمت تصویر هم‌خوان نیست.', 'IMAGE_SIGNATURE');
    }

    mkdirSync(this.directory, { recursive: true });
    const file = `${randomUUID()}.${EXTENSIONS[mime]}`;
    writeFileSync(join(this.directory, file), bytes);

    return { url: `/api/v1/public/product-images/${file}`, bytes: bytes.byteLength, mime };
  }

  read(file: string): { mime: string; bytes: Buffer } {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(file)) {
      throw notFound('تصویر یافت نشد.', 'IMAGE_NOT_FOUND');
    }

    const path = join(this.directory, file);
    if (!existsSync(path)) throw notFound('تصویر یافت نشد.', 'IMAGE_NOT_FOUND');

    const extension = file.split('.').pop();
    const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    return { mime, bytes: readFileSync(path) };
  }
}
