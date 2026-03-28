import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import 'katex/dist/katex.min.css';
import type { DocumentAnswerCitation, DocumentQuestionScope } from 'pdf-layout-parser';
import {
  type ChatMessage,
  type ChatAnnotationContent,
  type ChatScope,
  type AnnotationBounds,
  saveOrUpdateChatAnnotation,
  saveOrUpdateDocumentChatAnnotation,
  getChatAnnotation,
  getDocumentChatAnnotation,
  deleteAnnotation,
  deleteDocumentChatAnnotation,
  findAnnotationAtBounds
} from '../storage/annotationStorage';
import {
  answerDocumentQuestionTaskStream,
  askQuestionTaskStream
} from '../api/proxyTaskApi';
import { CitedAnswerMessage } from './CitedAnswerMessage';
import { renderMarkdownToHtml } from '../utils/markdownRenderer';

type ChatVariant = 'floating' | 'docked';
type ChatProvider = 'gemini' | 'openai' | 'codex';

interface ChatPromptBuildInput {
  query: string;
  messages: ChatMessage[];
  contextText: string;
  enableWebSearch: boolean;
  provider: ChatProvider;
}

type ChatPromptBuildResult =
  | string
  | {
      prompt: string;
      contextText?: string;
    };

interface MiniChatViewProps {
  contextText: string;
  provider?: ChatProvider;
  model?: string | null;
  onClose: () => void;
  position?: { top: number; left: number };
  documentId: string;
  taskDocumentId?: string | null;
  pageNumber?: number;
  bounds?: AnnotationBounds;
  onAnnotationChange?: () => void;
  initialQuery?: string;
  initialMessages?: ChatMessage[];
  enableWebSearch?: boolean;
  onChatActivityChange?: (delta: number) => void;
  chatScope?: ChatScope;
  variant?: ChatVariant;
  title?: string;
  subtitle?: string;
  emptyStateMessage?: string;
  inputPlaceholder?: string;
  inputDisabled?: boolean;
  buildPrompt?: (input: ChatPromptBuildInput) => Promise<ChatPromptBuildResult> | ChatPromptBuildResult;
  onCitationClick?: (citation: DocumentAnswerCitation) => void;
}

const SYSTEM_PROMPT = `You are a helpful assistant analyzing a specific paragraph from a PDF document.
The user will ask questions about the following text. Keep your answers concise and focused on the context provided.

Context from PDF:
"""{context}"""

Answer the user's questions based on this context. If the question cannot be answered from the context alone, say so.`;

function buildSelectionPrompt(
  query: string,
  messages: ChatMessage[],
  contextText: string,
  enableWebSearch: boolean,
  provider: ChatProvider
): string {
  const conversationHistory = messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');

  const webSearchHint = enableWebSearch
    ? provider === 'gemini'
      ? '\n\nYou have access to web search. If the user asks about topics not covered in the context, feel free to search for additional information and cite your sources.'
      : '\n\nIf the answer is not in the provided context, clearly say so.'
    : '';

  return SYSTEM_PROMPT.replace('{context}', contextText) + webSearchHint +
    (conversationHistory ? `\n\nPrevious conversation:\n${conversationHistory}\n\n` : '\n\n') +
    `User: ${query}`;
}

function requireSelectionAnchor(pageNumber?: number, bounds?: AnnotationBounds): {
  pageNumber: number;
  bounds: AnnotationBounds;
} {
  if (typeof pageNumber !== 'number' || !bounds) {
    throw new Error('Selection chat requires pageNumber and bounds.');
  }
  return { pageNumber, bounds };
}

export function MiniChatView({
  contextText,
  provider = 'gemini',
  model,
  onClose,
  position,
  documentId,
  taskDocumentId,
  pageNumber,
  bounds,
  onAnnotationChange,
  initialQuery,
  initialMessages,
  enableWebSearch = false,
  onChatActivityChange,
  chatScope = 'selection',
  variant = 'floating',
  title,
  subtitle,
  emptyStateMessage = 'Ask a question about this paragraph...',
  inputPlaceholder = 'Ask a question...',
  inputDisabled = false,
  buildPrompt,
  onCitationClick
}: MiniChatViewProps): JSX.Element {
  const isFloating = variant === 'floating';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingAssistantTimestamp, setStreamingAssistantTimestamp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [hasPersistedHistory, setHasPersistedHistory] = useState(false);
  const [storedContextText, setStoredContextText] = useState(contextText);
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAutoSentRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; width: number; height: number } | null>(null);

  useEffect(() => {
    setStoredContextText(contextText);
  }, [contextText]);

  useEffect(() => {
    if (!isFloating) {
      setDragPosition(null);
      setPanelSize(null);
      return;
    }
    setDragPosition(null);
    setPanelSize(null);
  }, [isFloating, position?.top, position?.left]);

  const handlePointerStart = useCallback((event: ReactMouseEvent) => {
    if (!isFloating) {
      return;
    }

    const target = event.target as HTMLElement;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (target.closest('.mini-chat-resize-handle')) {
      event.preventDefault();
      isResizingRef.current = true;
      resizeStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        width: container.offsetWidth,
        height: container.offsetHeight
      };
      return;
    }

    if (!target.closest('.mini-chat-drag-handle')) {
      return;
    }

    event.preventDefault();
    isDraggingRef.current = true;

    const style = container.style;
    dragStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      elemX: Number.parseFloat(style.left) || 0,
      elemY: Number.parseFloat(style.top) || 0
    };
  }, [isFloating]);

  useEffect(() => {
    if (!isFloating) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) {
        if (!isResizingRef.current || !resizeStartRef.current) {
          return;
        }

        const nextWidth = Math.max(300, resizeStartRef.current.width + (event.clientX - resizeStartRef.current.mouseX));
        const nextHeight = Math.max(260, resizeStartRef.current.height + (event.clientY - resizeStartRef.current.mouseY));
        const maxWidth = Math.max(300, window.innerWidth - 24);
        const maxHeight = Math.max(260, window.innerHeight - 24);
        setPanelSize({
          width: Math.min(nextWidth, maxWidth),
          height: Math.min(nextHeight, maxHeight)
        });
        return;
      }

      const deltaX = event.clientX - dragStartRef.current.mouseX;
      const deltaY = event.clientY - dragStartRef.current.mouseY;
      const newLeft = dragStartRef.current.elemX + deltaX;
      const newTop = dragStartRef.current.elemY + deltaY;

      setDragPosition({ top: newTop, left: newLeft });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isFloating]);

  useEffect(() => {
    hasAutoSentRef.current = false;
    setMessages([]);
    setHasPersistedHistory(false);
    setError(null);
    setIsLoadingHistory(true);

    let cancelled = false;
    async function loadExistingChat() {
      try {
        const existing = chatScope === 'document'
          ? await getDocumentChatAnnotation(documentId)
          : await getChatAnnotation(
              documentId,
              requireSelectionAnchor(pageNumber, bounds).pageNumber,
              requireSelectionAnchor(pageNumber, bounds).bounds
            );

        if (cancelled) {
          return;
        }

        if (existing) {
          const chatContent = existing.content as ChatAnnotationContent;
          setMessages(chatContent.messages);
          setStoredContextText(chatContent.contextText || contextText);
          setHasPersistedHistory(chatContent.messages.length > 0);
          return;
        }

        setStoredContextText(contextText);
        if (initialMessages && initialMessages.length > 0) {
          setMessages(initialMessages);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    }

    void loadExistingChat();
    return () => {
      cancelled = true;
    };
  }, [chatScope, contextText, documentId, pageNumber, bounds, initialMessages]);

  useEffect(() => {
    if (!isLoadingHistory) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [isLoadingHistory]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0 || isLoadingHistory) {
      return;
    }

    async function saveChat() {
      try {
        if (chatScope === 'document') {
          await saveOrUpdateDocumentChatAnnotation(documentId, storedContextText, messages);
        } else {
          const selectionAnchor = requireSelectionAnchor(pageNumber, bounds);
          await saveOrUpdateChatAnnotation(
            documentId,
            selectionAnchor.pageNumber,
            selectionAnchor.bounds,
            storedContextText,
            messages,
            'selection'
          );
        }
        onAnnotationChange?.();
      } catch (err) {
        console.error('Failed to save chat:', err);
      }
    }

    void saveChat();
  }, [messages, chatScope, documentId, pageNumber, bounds, storedContextText, isLoadingHistory, onAnnotationChange]);

  const handleSubmit = useCallback(async (queryOverride?: string) => {
    const trimmed = (queryOverride ?? input).trim();
    if (!trimmed || isLoading || inputDisabled) {
      return;
    }

    setError(null);
    if (!queryOverride) {
      setInput('');
    }
    const userMessage: ChatMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingAssistantTimestamp(null);
    let tracksChatActivity = false;
    const assistantTimestamp = Date.now();

    try {
      onChatActivityChange?.(1);
      tracksChatActivity = true;

      if (taskDocumentId) {
        const nextContextText = storedContextText;
        const groundedScope = buildGroundedQuestionScope(chatScope, pageNumber, bounds, nextContextText);
        let streamedText = '';
        const result = await answerDocumentQuestionTaskStream({
          documentId: taskDocumentId,
          question: trimmed,
          provider,
          ...(model && model.trim().length > 0 ? { model: model.trim() } : {}),
          scope: groundedScope
        }, {
          onDelta: (delta) => {
            streamedText += delta;
            setStreamingAssistantTimestamp(assistantTimestamp);
            setMessages((prev) => upsertAssistantMessage(prev, assistantTimestamp, streamedText));
          }
        });
        setMessages((prev) => upsertAssistantMessage(prev, assistantTimestamp, result.answerText, result));
        setStoredContextText(nextContextText);
      } else {
        const promptResult = buildPrompt
          ? await buildPrompt({
              query: trimmed,
              messages,
              contextText: storedContextText,
              enableWebSearch,
              provider
            })
          : buildSelectionPrompt(trimmed, messages, storedContextText, enableWebSearch, provider);
        const fullPrompt = typeof promptResult === 'string' ? promptResult : promptResult.prompt;
        const nextContextText = typeof promptResult === 'string'
          ? storedContextText
          : promptResult.contextText ?? storedContextText;
        let streamedText = '';
        const result = await askQuestionTaskStream({
          prompt: fullPrompt,
          provider,
          ...(model && model.trim().length > 0 ? { model: model.trim() } : {}),
          enableWebSearch
        }, {
          onDelta: (delta) => {
            streamedText += delta;
            setStreamingAssistantTimestamp(assistantTimestamp);
            setMessages((prev) => upsertAssistantMessage(prev, assistantTimestamp, streamedText));
          }
        });
        setMessages((prev) => upsertAssistantMessage(prev, assistantTimestamp, result.text));
        setStoredContextText(nextContextText);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get response';
      setError(message);
    } finally {
      if (tracksChatActivity) {
        onChatActivityChange?.(-1);
      }
      setStreamingAssistantTimestamp(null);
      setIsLoading(false);
    }
  }, [
    input,
    isLoading,
    inputDisabled,
    model,
    messages,
    storedContextText,
    enableWebSearch,
    provider,
    taskDocumentId,
    onChatActivityChange,
    buildPrompt,
    chatScope,
    pageNumber,
    bounds
  ]);

  useEffect(() => {
    if (
      initialQuery &&
      !hasAutoSentRef.current &&
      !isLoadingHistory &&
      messages.length === 0
    ) {
      hasAutoSentRef.current = true;
      void handleSubmit(initialQuery);
    }
  }, [initialQuery, isLoadingHistory, messages.length, handleSubmit]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSubmit();
      } else if (event.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose]
  );

  const handleDeleteChat = useCallback(async () => {
    if (messages.length === 0) {
      onClose();
      return;
    }

    try {
      if (chatScope === 'document') {
        await deleteDocumentChatAnnotation(documentId);
      } else {
        const selectionAnchor = requireSelectionAnchor(pageNumber, bounds);
        const annotation = await findAnnotationAtBounds(
          documentId,
          selectionAnchor.pageNumber,
          selectionAnchor.bounds,
          'chat'
        );
        if (annotation) {
          await deleteAnnotation(annotation.id);
        }
      }
      onAnnotationChange?.();
      setMessages([]);
      setHasPersistedHistory(false);
      setStoredContextText(contextText);
      onClose();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }, [messages.length, chatScope, contextText, documentId, pageNumber, bounds, onAnnotationChange, onClose]);

  const handleContainerClick = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
  }, []);

  const currentPosition = isFloating ? dragPosition ?? position : null;
  const positionStyle = currentPosition
    ? {
        top: `${currentPosition.top}px`,
        left: `${currentPosition.left}px`,
        ...(panelSize ? { width: `${panelSize.width}px`, height: `${panelSize.height}px` } : {})
      }
    : {};

  const className = [
    'mini-chat-view',
    isFloating ? 'mini-chat-view--floating' : 'mini-chat-view--docked',
    title || subtitle ? 'mini-chat-view--headed' : ''
  ].filter(Boolean).join(' ');
  const messagesClassName = [
    'mini-chat-messages',
    isFloating ? 'mini-chat-messages--floating' : 'mini-chat-messages--docked'
  ].join(' ');
  const hasStreamingAssistantMessage = streamingAssistantTimestamp !== null
    && messages.some((message) => message.role === 'assistant' && message.timestamp === streamingAssistantTimestamp);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...positionStyle, cursor: isDraggingRef.current ? 'grabbing' : 'default' }}
      onClick={handleContainerClick}
      onMouseDown={handlePointerStart}
    >
      {isFloating && (
        <div className="mini-chat-drag-handle">
          <DragIcon />
        </div>
      )}
      {(title || subtitle) && (
        <div className="mini-chat-header-bar">
          <div className="mini-chat-header-copy">
            {title ? <div className="mini-chat-title">{title}</div> : null}
            {subtitle ? <div className="mini-chat-subtitle">{subtitle}</div> : null}
          </div>
        </div>
      )}
      {messages.length > 0 && (
        <button
          type="button"
          className="mini-chat-delete"
          onClick={handleDeleteChat}
          aria-label="Delete chat"
          title="Delete this conversation"
        >
          <TrashIcon />
        </button>
      )}
      <button
        type="button"
        className="mini-chat-close"
        onClick={onClose}
        aria-label="Close chat"
      >
        <CloseIcon />
      </button>

      <div className={messagesClassName} ref={messagesContainerRef}>
        {isLoadingHistory && (
          <div className="mini-chat-empty">
            Loading conversation...
          </div>
        )}
        {!isLoadingHistory && messages.length === 0 && !isLoading && (
          <div className="mini-chat-empty">
            {emptyStateMessage}
          </div>
        )}
        {!isLoadingHistory && messages.length > 0 && hasPersistedHistory && (
          <div className="mini-chat-history-badge">
            Previous conversation restored
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`mini-chat-message mini-chat-message--${message.role}${
              isLoading && streamingAssistantTimestamp === message.timestamp ? ' mini-chat-message--streaming' : ''
            }`}
          >
            {message.role === 'assistant' && message.citedAnswer ? (
              <CitedAnswerMessage answer={message.citedAnswer} onCitationClick={onCitationClick} />
            ) : (
              <div
                className="mini-chat-message-content mini-chat-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(message.content) }}
              />
            )}
          </div>
        ))}
        {isLoading && !hasStreamingAssistantMessage && (
          <div className="mini-chat-message mini-chat-message--assistant">
            <div className="mini-chat-message-content mini-chat-loading">
              <LoadingDots />
            </div>
          </div>
        )}
        {error && (
          <div className="mini-chat-error">{error}</div>
        )}
      </div>

      <div className="mini-chat-input-area">
        <input
          ref={inputRef}
          type="text"
          className="mini-chat-input"
          placeholder={inputPlaceholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || inputDisabled}
        />
        <button
          type="button"
          className="mini-chat-send"
          onClick={() => void handleSubmit()}
          disabled={!input.trim() || isLoading || inputDisabled}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>
      {isFloating && (
        <div className="mini-chat-resize-handle" aria-hidden="true">
          <ResizeIcon />
        </div>
      )}
    </div>
  );
}

function buildGroundedQuestionScope(
  chatScope: ChatScope,
  pageNumber: number | undefined,
  bounds: AnnotationBounds | undefined,
  contextText: string
): DocumentQuestionScope {
  if (chatScope === 'document') {
    return {
      kind: 'document',
      ...(contextText.trim() ? { contextText } : {})
    };
  }

  const selectionAnchor = requireSelectionAnchor(pageNumber, bounds);
  return {
    kind: 'selection',
    pageNumber: selectionAnchor.pageNumber,
    bounds: selectionAnchor.bounds,
    ...(contextText.trim() ? { contextText } : {})
  };
}

function upsertAssistantMessage(
  messages: ChatMessage[],
  timestamp: number,
  content: string,
  citedAnswer?: ChatMessage['citedAnswer']
): ChatMessage[] {
  const nextMessage: ChatMessage = {
    role: 'assistant',
    content,
    timestamp,
    ...(citedAnswer ? { citedAnswer } : {})
  };
  const existingIndex = messages.findIndex((message) => message.role === 'assistant' && message.timestamp === timestamp);
  if (existingIndex >= 0) {
    const nextMessages = [...messages];
    nextMessages[existingIndex] = nextMessage;
    return nextMessages;
  }
  return [...messages, nextMessage];
}

function DragIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 6" width="16" height="6" aria-hidden="true">
      <circle cx="4" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="4" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="4.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M5.5 2V1.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V2M2 4h12M4 4v9.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ResizeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M5 14.5 14.5 5M9 14.5l5.5-5.5M13 14.5l1.5-1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2 8l12-5-5 12-2-5-5-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoadingDots(): JSX.Element {
  return (
    <span className="loading-dots">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
