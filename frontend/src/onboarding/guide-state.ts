import { apiGet, apiSend } from '../api';
import type { GuideChapter } from './guide-catalog';

export interface ChapterProgress { next: number; read: string[]; skipped: string[] }
export interface GuideProgress { version: 1; campaign: string; invited: boolean; completed: boolean; chapters: Record<string, ChapterProgress> }
export const emptyProgress = (): GuideProgress => ({ version: 1, campaign: '', invited: false, completed: false, chapters: {} });
export function guideChapterComplete(progress: GuideProgress, chapter: GuideChapter): boolean {
  const read = progress.chapters[chapter.id]?.read || [];
  return chapter.steps.every(step => read.includes(step.id));
}
export function guideResumePosition(progress: GuideProgress, chapter: GuideChapter): number {
  const row = progress.chapters[chapter.id];
  if (!row || guideChapterComplete(progress, chapter)) return 0;
  return row.next < chapter.steps.length ? row.next : chapter.steps.findIndex(step => !row.read.includes(step.id));
}
export type GuideAction = { action: 'dismiss' | 'reopen' | 'complete' }
  | { action: 'position'; chapter: string; next: number }
  | { action: 'step'; chapter: string; step: string; next: number; skipped: boolean };
export function readGuideProgress(): Promise<GuideProgress> {
  return apiGet<GuideProgress>('/api/tutorial-progress');
}
export function saveGuideProgress(campaign: string, action: GuideAction): Promise<GuideProgress> {
  return apiSend<GuideProgress>('/api/tutorial-progress', { campaign, ...action });
}
export function recordGuideStep(progress: GuideProgress, chapter: string, step: string, next: number, skipped: boolean): GuideProgress {
  const current = progress.chapters[chapter] || { next: 0, read: [], skipped: [] };
  const read = new Set(current.read), skip = new Set(current.skipped);
  if (skipped) { skip.add(step); read.delete(step) } else { read.add(step); skip.delete(step) }
  return { ...progress, chapters: { ...progress.chapters, [chapter]: { next, read: [...read], skipped: [...skip] } } };
}

export interface GuideRequest { chapter?: string; invitation?: boolean; reopen?: boolean }
let pending: GuideRequest | null = null;
const listeners = new Set<(request: GuideRequest) => void>();
export function openGuide(request: GuideRequest = {}): void {
  if (!listeners.size) pending = request;
  for (const listener of listeners) listener(request);
}
export function listenGuide(listener: (request: GuideRequest) => void): () => void {
  listeners.add(listener);
  if (pending) { const request = pending; pending = null; queueMicrotask(() => { if (listeners.has(listener)) listener(request) }) }
  return () => { listeners.delete(listener) };
}
