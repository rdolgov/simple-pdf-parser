export {
  keywordSearchDocument,
  type KeywordSearchResult,
  type KeywordSearchOptions
} from './keywordSearch';

export {
  useKeywordSearch,
  type UseKeywordSearchReturn
} from './useKeywordSearch';

export {
  // Types
  type TextChunk,
  type EmbeddedChunk,
  type DocumentEmbeddings,
  type SemanticSearchResult,
  type IndexingProgress,
  type SemanticSearchConfig,
  type IndexDocumentOptions,

  // Processing functions
  chunkDocument,
  chunkDocumentByBlocks,
  semanticSearch,
  indexDocument,
  isSemanticIndexCompatibleWithConfig
} from './semanticSearch';

export {
  useSemanticSearch,
  type UseSemanticSearchOptions,
  type UseSemanticSearchReturn
} from './useSemanticSearch';
