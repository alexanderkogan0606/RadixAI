/** Sequential, checkpointed discovery. Each request is saved by the server before the next starts. */
export type ResearchCheckpoint = {
  id?: string;
  providers?: readonly {status: string}[];
  search?: {canContinue: boolean; batch: number; totalDocuments: number};
};
export async function runDeepResearch<T extends ResearchCheckpoint>(options: {
  query: string;
  continueFrom?: string;
  batches: number;
  request: (message: string, parent?: string) => Promise<T | undefined>;
  shouldStop: () => boolean;
  onBatch: (result: T, completed: number) => void;
}): Promise<{completed: number; reason: 'stopped' | 'unavailable' | 'complete' | 'budget' | 'error'}> {
  const budget = Math.max(1, Math.min(20, Math.floor(options.batches) || 1));
  let parent = options.continueFrom, completed = 0;
  while (completed < budget) {
    if (options.shouldStop()) return {completed, reason: 'stopped'};
    const result = await options.request(parent ? 'Find more' : options.query, parent);
    if (!result) return {completed, reason: 'error'};
    completed++;
    options.onBatch(result, completed);
    if (options.shouldStop()) return {completed, reason: 'stopped'};
    if (result.providers?.length && result.providers.every(provider => !['ok', 'empty'].includes(provider.status))) return {completed, reason: 'unavailable'};
    if (!result.id || !result.search?.canContinue) return {completed, reason: 'complete'};
    parent = result.id;
  }
  return {completed, reason: 'budget'};
}
