/**
 * headlineService.interface.ts
 *
 * Defines the contract that both the mock service and any future real API
 * service must implement. Downstream Oracle consumers import from this
 * interface so swapping mock → real never requires touching pipeline files.
 */

export interface HeadlineEvent {
  headline: string;
  sentimentScore: number;
  relatedIndex: string;
  source: string;
  category: string;
}

export interface IHeadlineService {
  // Returns the next headline for a specific index.
  // Returns null if no headlines are available for that index.
  getNextHeadlineForIndex(indexName: string): HeadlineEvent | null;

  // Returns all available headlines across all indexes.
  getAllHeadlines(): HeadlineEvent[];

  // Returns whether a given index name is actively tracked.
  isActiveIndex(indexName: string): boolean;

  // Returns the weighted index name for random dispatch.
  // Used by the Oracle tick when no specific index is targeted.
  pickWeightedIndex(): string;
}
