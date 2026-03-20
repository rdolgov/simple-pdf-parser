export interface InteractiveWidgetSpec {
  title: string;
  html: string;
  css: string;
  js: string;
}

export interface InteractiveWidgetPromptContext {
  documentTitle?: string;
  selectedText: string;
  sectionHeading?: string;
  sectionText?: string;
}

const WIDGET_CSP = [
  "default-src 'none'",
  "img-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

export function buildInteractiveWidgetPrompt(context: InteractiveWidgetPromptContext): string {
  const documentLabel = context.documentTitle?.trim() || 'this document';
  const sectionHeading = context.sectionHeading?.trim() || 'None';
  const sectionText = context.sectionText?.trim() || context.selectedText.trim();

  return `Create a compact, self-contained HTML/CSS/JavaScript teaching widget that helps a reader understand a selected paragraph from ${documentLabel}.

Selected paragraph:
"""${context.selectedText.trim()}"""

Current section heading:
"""${sectionHeading}"""

Current section context:
"""${sectionText}"""

Requirements:
- The widget must be educational, interactive, and understandable without external resources.
- Use only vanilla HTML, CSS, and JavaScript.
- No external libraries, fonts, images, network requests, forms, popups, navigation, storage APIs, or parent-window access.
- Fit comfortably in a panel around 560px wide and 520px tall.
- Keep the full widget visible inside the viewport without scrolling when reasonably possible.
- Include a clear title, a concise explanation, and at least one interactive control such as tabs, buttons, a slider, or a toggle.
- Prefer simple visual metaphors, worked examples, or step-by-step exploration.
- Keep the tone practical and explanatory, not flashy.
- Return strict JSON only, with this exact shape:
{
  "title": "Short widget title",
  "html": "<div>...</div>",
  "css": "/* widget styles */",
  "js": "/* widget behavior */"
}

Important:
- Protocol marker: interactive_widget_v1
- The "html" field must be a fragment only, not a full document.
- Put all styling in "css" and all behavior in "js".
- The "js" field must work when executed after the HTML has already been inserted into the DOM.
- Do not wrap the JSON in markdown fences.`;
}

export function parseInteractiveWidgetSpec(rawText: string): InteractiveWidgetSpec {
  const cleaned = stripCodeFences(rawText.trim());
  const jsonText = extractJsonObject(cleaned);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Widget response was not valid JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Widget response JSON was empty.');
  }

  const record = parsed as Record<string, unknown>;
  const title = normalizeNonEmptyString(record.title) ?? 'Interactive explainer';
  const html = normalizeNonEmptyString(record.html);
  if (!html) {
    throw new Error('Widget response did not include an html fragment.');
  }

  return {
    title,
    html: sanitizeHtmlFragment(html),
    css: sanitizeCss(normalizeString(record.css)),
    js: sanitizeJs(normalizeString(record.js))
  };
}

export function buildInteractiveWidgetSrcDoc(spec: InteractiveWidgetSpec): string {
  const safeTitle = escapeHtml(spec.title);
  const safeHtml = spec.html;
  const safeCss = spec.css.replace(/<\/style/gi, '<\\/style');
  const safeJs = spec.js.replace(/<\/script/gi, '<\\/script');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Georgia, "Times New Roman", serif;
        background: #f5f2ea;
        color: #1f2933;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(200, 155, 94, 0.18), transparent 38%),
          linear-gradient(180deg, #fffdf8 0%, #f2ecdf 100%);
      }

      body {
        padding: 0;
      }

      #widget-shell {
        width: 100%;
        height: 100vh;
        padding: 10px;
      }

      #widget-viewport {
        width: 100%;
        height: 100%;
        overflow: auto;
      }

      #widget-frame {
        width: calc(var(--widget-content-width, 100%) * var(--widget-scale, 1));
        min-height: calc(var(--widget-content-height, 100%) * var(--widget-scale, 1));
      }

      #widget-root {
        width: var(--widget-content-width, auto);
        min-height: var(--widget-content-height, auto);
        transform: scale(var(--widget-scale, 1));
        transform-origin: top left;
      }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      ${safeCss}
    </style>
  </head>
  <body>
    <div id="widget-shell">
      <div id="widget-viewport">
        <div id="widget-frame">
          <div id="widget-root">${safeHtml}</div>
        </div>
      </div>
    </div>
    <script>
      (() => {
        "use strict";
        const viewport = document.getElementById("widget-viewport");
        const frame = document.getElementById("widget-frame");
        const root = document.getElementById("widget-root");

        let fitFrame = 0;
        const scheduleFit = () => {
          if (fitFrame) {
            cancelAnimationFrame(fitFrame);
          }
          fitFrame = requestAnimationFrame(() => {
            fitFrame = requestAnimationFrame(() => {
              if (!viewport || !frame || !root) {
                return;
              }

              root.style.removeProperty("--widget-scale");
              root.style.transform = "scale(1)";
              root.style.width = "max-content";
              root.style.minHeight = "0";

              const naturalWidth = Math.max(root.scrollWidth, root.offsetWidth, 1);
              const naturalHeight = Math.max(root.scrollHeight, root.offsetHeight, 1);
              const availableWidth = Math.max(viewport.clientWidth, 1);
              const availableHeight = Math.max(viewport.clientHeight, 1);
              const scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);

              document.documentElement.style.setProperty("--widget-scale", String(scale));
              document.documentElement.style.setProperty("--widget-content-width", naturalWidth + "px");
              document.documentElement.style.setProperty("--widget-content-height", naturalHeight + "px");
              frame.style.width = "calc(" + naturalWidth + "px * " + scale + ")";
              frame.style.minHeight = "calc(" + naturalHeight + "px * " + scale + ")";
              root.style.width = naturalWidth + "px";
              root.style.minHeight = naturalHeight + "px";
              root.style.transform = "scale(" + scale + ")";
            });
          });
        };

        try {
          ${safeJs}
        } catch (error) {
          const fallback = document.createElement("div");
          fallback.style.marginTop = "12px";
          fallback.style.padding = "10px 12px";
          fallback.style.borderRadius = "10px";
          fallback.style.background = "rgba(153, 27, 27, 0.08)";
          fallback.style.color = "#991b1b";
          fallback.style.font = '600 13px/1.45 system-ui, sans-serif';
          fallback.textContent = "Widget script error: " + (error instanceof Error ? error.message : String(error));
          document.body.appendChild(fallback);
        }

        if (root) {
          const mutationObserver = new MutationObserver(scheduleFit);
          mutationObserver.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true
          });
        }

        if (viewport && "ResizeObserver" in window) {
          const resizeObserver = new ResizeObserver(scheduleFit);
          resizeObserver.observe(viewport);
          resizeObserver.observe(document.body);
        }

        document.addEventListener("input", scheduleFit, true);
        document.addEventListener("change", scheduleFit, true);
        window.addEventListener("load", scheduleFit);
        window.addEventListener("resize", scheduleFit);
        scheduleFit();
      })();
    </script>
  </body>
</html>`;
}

function stripCodeFences(value: string): string {
  if (!value.startsWith('```')) {
    return value;
  }
  return value.replace(/^```(?:json|html)?\s*/i, '').replace(/\s*```$/, '');
}

function extractJsonObject(value: string): string {
  if (value.startsWith('{')) {
    return value;
  }
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return value.slice(start, end + 1);
  }
  return value;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeHtmlFragment(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:html|head|body|meta|link|base|iframe|object|embed)\b[^>]*>/gi, '')
    .trim();
}

function sanitizeCss(value: string): string {
  return value
    .replace(/<\/?style\b[^>]*>/gi, '')
    .trim();
}

function sanitizeJs(value: string): string {
  return value
    .replace(/^<script\b[^>]*>/i, '')
    .replace(/<\/script>$/i, '')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
