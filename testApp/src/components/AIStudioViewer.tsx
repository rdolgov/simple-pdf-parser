import aiStudioDoc from '../../../data/ai_studio_code.json';

type AIStudioDocument = typeof aiStudioDoc;
type AIStudioElement = AIStudioDocument['pages'][number]['elements'][number];

const PAGE_WIDTH = 720;
const PAGE_HEIGHT = 1024;

const COLOR_MAP: Record<AIStudioElement['type'], string> = {
  title: '#111827',
  authors: '#334155',
  heading: '#0ea5e9',
  paragraph: '#1f2937',
  footnote: '#9333ea',
  image: '#10b981',
  caption: '#6366f1'
};

export function AIStudioViewer(): JSX.Element {
  return (
    <div className="ai-studio-viewer">
      <header className="ai-studio-header">
        <div>
          <p className="ai-studio-kicker">AI Studio Export</p>
          <h2>{aiStudioDoc.document_title}</h2>
          <p className="ai-studio-subtitle">Static render of normalized page elements from data/ai_studio_code.json</p>
        </div>
        <div className="ai-studio-legend">
          {Object.entries(COLOR_MAP).map(([key, color]) => (
            <span key={key} className="ai-studio-chip" style={{ background: color }}>
              {key}
            </span>
          ))}
        </div>
      </header>

      <div className="ai-studio-pages">
        {aiStudioDoc.pages.map((page) => (
          <section key={page.page_number} className="ai-studio-page">
            <div className="ai-studio-page-label">Page {page.page_number}</div>
            <div className="ai-studio-canvas" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }}>
              {page.elements.map((element, index) => (
                <AIStudioBlock key={`${page.page_number}-${index}`} element={element} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function formatContent(element: AIStudioElement): string {
  if (typeof element.content === 'string') {
    return element.content;
  }
  if (typeof element.description === 'string') {
    return element.description;
  }
  if (element.type === 'table' && element.content && typeof element.content === 'object') {
    const caption = (element.content as any).caption ?? 'Table';
    const rows = Array.isArray((element.content as any).rows) ? (element.content as any).rows.length : 0;
    return `${caption} (${rows} rows)`;
  }
  if (element.content && typeof element.content === 'object') {
    try {
      return JSON.stringify(element.content);
    } catch {
      return '[object content]';
    }
  }
  return '';
}

function AIStudioBlock({ element }: { element: AIStudioElement }): JSX.Element {
  const [x, y, w, h] = element.bounding_box;
  const left = x * PAGE_WIDTH;
  const top = y * PAGE_HEIGHT;
  const width = w * PAGE_WIDTH;
  const height = h * PAGE_HEIGHT;
  const color = COLOR_MAP[element.type] ?? '#111827';
  const content = formatContent(element);

  return (
    <div
      className="ai-studio-block"
      style={{
        left,
        top,
        width,
        height,
        borderColor: color,
        color
      }}
    >
      <div className="ai-studio-block-type">{element.type}</div>
      <div className="ai-studio-block-content">{content}</div>
    </div>
  );
}
