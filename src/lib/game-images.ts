import { supabase } from './supabase';

export const GAME_IMAGE_BUCKET = 'game-images';
export const MAX_GAME_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateGameImage(file: File | null): string | null {
  if (!file || file.size === 0) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'La imagen debe estar en formato JPG, PNG o WebP.';
  if (file.size > MAX_GAME_IMAGE_BYTES) return 'La imagen no puede superar los 5 MB.';
  return null;
}

export function getGameImageUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from(GAME_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

export async function uploadGameImage(gameId: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const problem = validateGameImage(file);
  if (problem) return { path: null, error: problem };
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
  const path = `${gameId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(GAME_IMAGE_BUCKET).upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
  return error ? { path: null, error: error.message } : { path, error: null };
}
