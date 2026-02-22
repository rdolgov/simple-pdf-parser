import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { GeminiAPI, createGoogleSearchTool } from 'pdf-layout-parser';
import {
  type ChatMessage,
  type ChatAnnotationContent,
  type AnnotationBounds,
  saveOrUpdateChatAnnotation,
  getChatAnnotation,
  deleteAnnotation,
  findAnnotationAtBounds
} from '../storage/annotationStorage';


interface MiniChatViewProps {
  contextText: string;
  apiKey: string;
  onClose: () => void;
  position?: { top: number; left: number };
  documentId: string;
  pageNumber: number;
  bounds: AnnotationBounds;
  onAnnotationChange?: () => void;
  /** If provided, this query will be auto-sent when the chat opens */
  initialQuery?: string;
  /** When enabled, allows Gemini to search the web for additional context */
  enableWebSearch?: boolean;
}

const SYSTEM_PROMPT = `You are a helpful assistant analyzing a specific paragraph from a PDF document.
The user will ask questions about the following text. Keep your answers concise and focused on the context provided.

Context from PDF:
"""{context}"""

Answer the user's questions based on this context. If the question cannot be answered from the context alone, say so.`;

export function MiniChatView({
  contextText,
  apiKey,
  onClose,
  position,
  documentId,
  pageNumber,
  bounds,
  onAnnotationChange,
  initialQuery,
  enableWebSearch = false
}: MiniChatViewProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const hasAutoSentRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);

  // Reset drag position when click position changes (always open next to clicked button)
  useEffect(() => {
    setDragPosition(null);
  }, [position?.top, position?.left]);


  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    // Only start drag from the drag handle
    const target = e.target as HTMLElement;
    if (!target.closest('.mini-chat-drag-handle')) {
      return;
    }
    e.preventDefault();
    isDraggingRef.current = true;

    const container = containerRef.current;
    if (container) {
      // Get current position from inline style or computed style
      const style = container.style;
      const currentTop = parseFloat(style.top) || 0;
      const currentLeft = parseFloat(style.left) || 0;

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elemX: currentLeft,
        elemY: currentTop
      };
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      const newLeft = dragStartRef.current.elemX + deltaX;
      const newTop = dragStartRef.current.elemY + deltaY;

      setDragPosition({ top: newTop, left: newLeft });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Load existing chat history on mount
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    async function loadExistingChat() {
      try {
        const existing = await getChatAnnotation(documentId, pageNumber, bounds);
        if (existing) {
          const chatContent = existing.content as ChatAnnotationContent;
          setMessages(chatContent.messages);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    }

    void loadExistingChat();
  }, [documentId, pageNumber, bounds]);

  useEffect(() => {
    // Focus input without scrolling the page (after history loads)
    if (!isLoadingHistory) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [isLoadingHistory]);

  useEffect(() => {
    // Scroll only within the messages container, not the whole page
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Save chat to storage when messages change
  useEffect(() => {
    if (messages.length === 0 || isLoadingHistory) return;

    async function saveChat() {
      try {
        await saveOrUpdateChatAnnotation(documentId, pageNumber, bounds, contextText, messages);
        onAnnotationChange?.();
      } catch (err) {
        console.error('Failed to save chat:', err);
      }
    }

    void saveChat();
  }, [messages, documentId, pageNumber, bounds, contextText, isLoadingHistory, onAnnotationChange]);

  const handleSubmit = useCallback(async (queryOverride?: string) => {
    const trimmed = (queryOverride ?? input).trim();
    if (!trimmed || isLoading || !apiKey) {
      return;
    }

    setError(null);
    if (!queryOverride) {
      setInput('');
    }
    const userMessage: ChatMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const tools = enableWebSearch ? [createGoogleSearchTool()] : undefined;
      const api = new GeminiAPI({ apiKey, tools });

      const conversationHistory = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

      const webSearchHint = enableWebSearch
        ? '\n\nYou have access to web search. If the user asks about topics not covered in the context, feel free to search for additional information and cite your sources.'
        : '';

      const fullPrompt = SYSTEM_PROMPT.replace('{context}', contextText) + webSearchHint +
        (conversationHistory ? `\n\nPrevious conversation:\n${conversationHistory}\n\n` : '\n\n') +
        `User: ${trimmed}`;

      const result = await api.generateText(fullPrompt);
      const assistantMessage: ChatMessage = { role: 'assistant', content: result.text, timestamp: Date.now() };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get response';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, apiKey, messages, contextText, enableWebSearch]);

  // Auto-send initial query if provided
  useEffect(() => {
    if (
      initialQuery &&
      !hasAutoSentRef.current &&
      !isLoadingHistory &&
      apiKey &&
      messages.length === 0
    ) {
      hasAutoSentRef.current = true;
      void handleSubmit(initialQuery);
    }
  }, [initialQuery, isLoadingHistory, apiKey, messages.length, handleSubmit]);

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
      const annotation = await findAnnotationAtBounds(documentId, pageNumber, bounds, 'chat');
      if (annotation) {
        await deleteAnnotation(annotation.id);
        onAnnotationChange?.();
      }
      setMessages([]);
      onClose();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }, [messages.length, documentId, pageNumber, bounds, onAnnotationChange, onClose]);

  const handleContainerClick = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
  }, []);

  // Use drag position if set, otherwise fall back to prop position
  const currentPosition = dragPosition ?? position;
  const positionStyle = currentPosition
    ? { top: `${currentPosition.top}px`, left: `${currentPosition.left}px` }
    : {};

  return (
    <div
      ref={containerRef}
      className="mini-chat-view"
      style={{ ...positionStyle, cursor: isDraggingRef.current ? 'grabbing' : 'default' }}
      onClick={handleContainerClick}
      onMouseDown={handleDragStart}
    >
      <div className="mini-chat-drag-handle">
        <DragIcon />
      </div>
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

      <div className="mini-chat-messages" ref={messagesContainerRef}>
        {isLoadingHistory && (
          <div className="mini-chat-empty">
            Loading conversation...
          </div>
        )}
        {!isLoadingHistory && messages.length === 0 && !isLoading && (
          <div className="mini-chat-empty">
            Ask a question about this paragraph...
          </div>
        )}
        {!isLoadingHistory && messages.length > 0 && (
          <div className="mini-chat-history-badge">
            Previous conversation restored
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`mini-chat-message mini-chat-message--${message.role}`}
          >
            <div className="mini-chat-message-content">{message.content}</div>
          </div>
        ))}
        {isLoading && (
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
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || !apiKey}
        />
        <button
          type="button"
          className="mini-chat-send"
          onClick={() => void handleSubmit()}
          disabled={!input.trim() || isLoading || !apiKey}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>

      {!apiKey && (
        <div className="mini-chat-no-key">
          Gemini API key required. Set it in the Gemini Playground tab.
        </div>
      )}
    </div>
  );
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
