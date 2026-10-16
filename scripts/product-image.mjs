// Product photos are only shown as small thumbnails (88 px, 176 px for
// high-density screens), so they are stored at that size as WebP.
import sharp from 'sharp';

export const THUMBNAIL_SIZE = 176;

export function productThumbnail(body) {
  return sharp(body)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}
