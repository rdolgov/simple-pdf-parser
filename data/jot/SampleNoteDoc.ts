/*************************************************************************
 * ADOBE CONFIDENTIAL
 * ___________________
 *
 *  Copyright 2025 Adobe
 *  All Rights Reserved.
 *
 * NOTICE:  All information contained herein is, and remains
 * the property of Adobe and its suppliers, if any. The intellectual
 * and technical concepts contained herein are proprietary to Adobe
 * and its suppliers and are protected by all applicable intellectual
 * property laws, including trade secret and copyright laws.
 * Dissemination of this information or reproduction of this material
 * is strictly forbidden unless prior written permission is obtained
 * from Adobe.
 **************************************************************************/
/* eslint-disable @stylistic/max-len */

import { JotNote } from "../src/types/JotNote";
import { NDElement } from "../src/types/NoteDocTypes";

function addBlock(
  name: string,
  text: string,
): NDElement {
  return {
    type: name,
    children: [{ text }],
  };
}

const SampleNoteDoc: JotNote = {
  id: "sample-note",
  schemaVersion: "0.0.1",
  type: "note",
  contents: [
    addBlock("h1", "🌳 Jot Sample Document"),
    {
      type: "blockquote",
      children: [
        { text: "To test readonly mode, load this page with URL parameter '?readonly'\nIn readonly mode, attributions will be shown." },
      ],
    },
    {
      type: "blockquote",
      children: [
        { text: "To test streaming, navigate to /stream.html" },
      ],
    },
    {
      type: "blockquote",
      children: [
        { text: "To test note-doc, load this page with URL parameter '?note-doc'" },
      ],
    },
    addBlock("h3", "Playwright Test Modes"),
    {
      type: "blockquote",
      children: [
        { text: "To load test page that's used for automation, navigate to /playwright.html" },
      ],
    },
    {
      type: "blockquote",
      children: [
        { text: "Playwright Test Modes:\n- Bottom Bar Mode: ?enableBottomFormattingBar=true\n- Floating Toolbar Mode: ?enableFloatingToolbar=true\n- Menu Bar: ?enableMenuBar=true\n- Sidebar: ?enableSidebar=true\n- Read-only: ?readonly" },
      ],
    },
    {
      type: "blockquote",
      children: [
        { text: "Example URLs:\n- Note-doc with Bottom Bar: http://localhost:1234/playwright.html?enableBottomFormattingBar=true\n- Note-doc with Floating Toolbar: http://localhost:1234/playwright.html?enableFloatingToolbar=true\n- Readonly mode: http://localhost:1234/playwright.html?readonly" },
      ],
    },
    addBlock("h2", "Horizontal Rule"),
    addBlock(
      "paragraph",
      "Add horizontal rules to visually separate sections and content within your document.",
    ),
    { type: "hrule" },
    {
      type: "paragraph",
      children: [
        { text: "Make text " },
        { text: "bold", bold: true },
        { text: ", " },
        { text: "italic", italic: true },
        { text: ", " },
        { text: "underline", underline: true },
        { text: ", or apply a " },
        { text: "combination", bold: true, italic: true, underline: true },
        { text: " of these styles for a visually striking effect." },
      ],
    },
    {
      type: "paragraph",
      children: [
        { text: "You can also apply " },
        { text: "strikethrough", strikethrough: true },
        {
          text: " to text to indicate that it has been removed or is no longer relevant.",
        },
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          text: "Highlight important information using various colors such as: ",
        },
        { text: "red", color: "#FE0000" },
        { text: ", " },
        { text: "purple", color: "#9900FF" },
        { text: ", or " },
        { text: "orange", color: "#FE9900" },
        { text: "; or emphasize text using " },
        { text: "various", highlight: "#FFD966" },
        { text: " " },
        { text: "highlight", highlight: "#FE9900" },
        { text: " colors." },
      ],
    },
    {
      type: "paragraph",
      children: [
        { text: "Apply " },
        { text: "superscript", superscript: true },
        { text: " or " },
        { text: "subscript", subscript: true },
        { text: " to text to indicate its position relative to the baseline." },
      ],
    },
    addBlock("h2", "🔤 Font Styles"),
    {
      type: "paragraph",
      children: [
        {
          text: "Change the font style of text to make it more visually appealing such as ",
        },
        { text: "Arial", fontName: "Arial" },
        { text: ", " },
        { text: "Verdana", fontName: "Verdana" },
        { text: ", " },
        { text: "Times New Roman", fontName: "Times New Roman" },
        { text: ", or just use simple " },
        { text: "Monospace", fontName: "Monospace" },
        { text: " font." },
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          text: "Change the font size of text to make it more readable such as ",
        },
        { text: "small", fontSize: "10px" },
        { text: ", " },
        { text: "medium", fontSize: "24px" },
        { text: ", or " },
        { text: "large", fontSize: "48px" },
        { text: " font sizes." },
      ],
    },
    {
      type: "paragraph",
      children: [
        { text: "Write code snippets with " },
        { text: "inline code", code: true },
        { text: " formatting for easy readability." },
      ],
    },
    addBlock("h2", "\u201d Blockquotes"),
    {
      type: "blockquote",
      children: [{ text: "Create blockquotes to emphasize important information or highlight quotes from external sources.", italic: true }],
    },
    addBlock("h2", "🔗 Links"),
    {
      type: "paragraph",
      children: [
        {
          text: "Add ",
        },
        {
          type: "link",
          href: "https://www.adobe.com",
          children: [{ text: "hyperlinks" }],
        },
        {
          text: " within your text to reference external sources or provide additional information using the Link plugin. You can also use keyboard keys to display: ",
        },
        {
          text: ". Even an inline image works: check this: ",
        },
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          text: "Please note that ",
        },
        {
          type: "link",
          href: "acroprompt://Expand%20on%20the%20Brachiosaurus%27s%20habitat%20and%20behavior",
          children: [{ text: "acroprompt-link" }],
        },
        {
          text: " would be shown as plain text",
        },
      ],
    },
    {
      type: "image",
      src: "https://placehold.co/50x50",
    },
    addBlock("h2", "Indent List"),
    {
      type: "unordered-list",
      children: [
        {
          type: "list-item",
          children: [
            { type: "paragraph", children: [{ text: "Fruits" }] },
            {
              type: "unordered-list",
              children: [
                {
                  type: "list-item",
                  children: [{ text: "Apple" }],
                },
                {
                  type: "list-item",
                  children: [{ text: "Peach" }],
                },
              ],
            },
          ],
        },
        {
          type: "list-item",
          children: [
            { type: "paragraph", children: [{ text: "Flowers" }] },
            {
              type: "unordered-list",
              children: [
                {
                  type: "list-item",
                  children: [{ text: "Rose" }],
                },
                {
                  type: "list-item",
                  children: [{ text: "Violet" }],
                },
              ],
            },
          ],
        },
      ],
    },
    addBlock("paragraph", ""),
    addBlock("h1", "Typography"),
    addBlock(
      "paragraph",
      "Typography allows users to style text in various ways to make it more visually appealing and easier to read.",
    ),
    {
      type: "div",
      children: [
        addBlock("h1", "Heading 1"),
        addBlock("h2", "Heading 2"),
        addBlock("h3", "Heading 3"),
        addBlock("h4", "Heading 4"),
        addBlock("h5", "Heading 5"),
        addBlock("h6", "Heading 6"),
      ],
    },
    {
      type: "div",
      children: [
        {
          type: "div",
          children: [
            addBlock("h1", "📸 Image"),
            addBlock(
              "paragraph",
              "Embed images within your document to make it more visually appealing by providing a src attribute.",
            ),
            {
              type: "image",
              src: "https://odin.adobe.com/content/dam/ccsurfaces/adobe-home/en_US/assets/firefly-for-enterprise/ff_text_to_image.jpg",
            },
          ],
        },
      ],
    },
    addBlock("h1", "Code Blocks"),
    { type: "paragraph", children: [{ text: "some code text", code: true }] },
    addBlock("h1", "Content styling"),
    addBlock("h1", "Preformatted text"),
    {
      type: "pre",
      children: [{ text: "Preformatted text\nWith line 2\nand line 3\n  and   multiple    spaces" }],
    },
    addBlock("h1", "Tables"),
    {
      type: "table",
      children: [
        {
          type: "table-head",
          children: [
            {
              type: "table-row",
              children: [
                { type: "table-head-cell", children: [{ text: "Name" }] },
                { type: "table-head-cell", children: [{ text: "Age" }] },
              ],
            },
          ],
        },
        {
          type: "table-body",
          children: [
            {
              type: "table-row",
              children: [
                { type: "table-cell", children: [{ text: "Alice" }] },
                { type: "table-cell", children: [{ text: "24" }] },
              ],
            },
            {
              type: "table-row",
              children: [
                { type: "table-cell", children: [{ text: "Bob" }] },
                { type: "table-cell", children: [{ text: "30" }] },
              ],
            },
          ],
        },
        {
          type: "table-foot",
          children: [
            {
              type: "table-row",
              children: [
                { type: "table-cell", children: [{ text: "" }] },
                { type: "table-cell", children: [{ text: "Average age: 27" }] },
              ],
            },
          ],
        },
      ],
    },

    {
      type: "paragraph",
      children: [
        {
          text: "Peaches grow on trees in temperate climates",
        }],
    },
    {
      type: "paragraph",
      children: [
        {
          text: "Peaches grow on trees in temperate climates — they need warm weather, but they also require a hard freeze in the winter to produce fruit.",
        },
        {
          type: "attribution",
          description: "Peaches need warm weather to grow.",
          documentId: "f5d8a8d6-2f65-4b49-a6d2-a13b224fbf8b",
          bounds: [
            {
              page: 4,
              rects: [
                {
                  left: 168.25987243652344,
                  top: 92.24639892578125,
                  right: 229.70851135253906,
                  bottom: 102.97535705566406,
                },
              ],
            },
          ],
          range: [0, 68],
        },
        {
          type: "attribution",
          description: "Attribution 2 description",
          documentId: "NEW-f5d8a8d6-2f65-4b49-a6d2-a13b224fbf8b",
          bounds: [
            {
              page: 2,
              rects: [
                {
                  left: 168.25987243652344,
                  top: 92.24639892578125,
                  right: 229.70851135253906,
                  bottom: 102.97535705566406,
                },
              ],
            },
          ],
          range: [5, 68],
        },
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          text: "Peaches grow on trees in temperate climates — they need warm weather, but they also require a hard freeze in the winter to produce fruit.",
        },
        {
          type: "attribution",
          description: "Peaches need warm weather to grow.",
          documentId: "f5d8a8d6-2f65-4b49-a6d2-a13b224fbf8b",
          bounds: [
            {
              page: 4,
              rects: [
                {
                  left: 168.25987243652344,
                  top: 92.24639892578125,
                  right: 229.70851135253906,
                  bottom: 102.97535705566406,
                },
              ],
            },
          ],
          range: [5, 68],
        },
      ],
    },
    addBlock("h1", "Inline Math Equations"),
    {
      type: "paragraph",
      children: [
        { text: "Quadratic Formula " },
        {
          type: "math",
          text: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
          inline: true,
          children: [{ text: "" }],
        },
      ],
    },
    addBlock("h1", "Block Math Equations"),
    {
      type: "paragraph",
      children: [
        { text: "Taylor Series Formula " },
        {
          type: "math",
          text: "\\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n = f(a) + f'(a)(x-a) + \\frac{f''(a)}{2!}(x-a)^2 + \\frac{f'''(a)}{3!}(x-a)^3 + \\cdots + \\frac{f^{(n)}(a)}{n!}(x-a)^n + R_n(x)",
          inline: false,
          children: [{ text: "" }],
        },
      ],
    },
    addBlock("paragraph", ""),
    {
      type: "quiz",
      id: "programming-quiz-001",
      children: [
        {
          type: "paragraph",
          children: [
            {
              text: "Welcome to the Programming Fundamentals Quiz! This quiz contains 3 questions to test your knowledge of basic programming concepts. Good luck!",
            },
          ],
        },
        {
          type: "field-group",
          id: "question-1",
          children: [
            {
              type: "instructions",
              children: [
                {
                  text: "Question 1: What is the primary purpose of a variable in programming?",
                  bold: true,
                },
              ],
            },
            {
              type: "data-field",
              id: "q1-option-a",
              fieldType: "radio",
              name: "q1-answer",
              value: "a",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "To store and manipulate data",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q1-option-b",
              fieldType: "radio",
              name: "q1-answer",
              value: "b",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "To create beautiful user interfaces",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q1-option-c",
              fieldType: "radio",
              name: "q1-answer",
              value: "c",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "To connect to the internet",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q1-option-d",
              fieldType: "radio",
              name: "q1-answer",
              value: "d",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "To format text documents",
                    },
                  ],
                },
              ],
            },
            {
              type: "quiz-explanation",
              children: [
                {
                  text: "Variables are fundamental building blocks in programming that allow you to store and manipulate data. They act as containers for values that can change during program execution.",
                },
                {
                  type: "attribution",
                  description: "Variables are fundamental building blocks in programming.",
                  documentId: "urn:aaid:sc:VA6C2:programming-fundamentals-001",
                  bounds: [
                    {
                      page: 1,
                      rects: [
                        {
                          left: 72.0,
                          top: 120.5,
                          right: 380.2,
                          bottom: 132.8,
                        },
                      ],
                    },
                  ],
                  range: [0, 81],
                },
                {
                  type: "attribution",
                  description: "Variables act as containers for values.",
                  documentId: "urn:aaid:sc:VA6C2:programming-fundamentals-002",
                  bounds: [
                    {
                      page: 1,
                      rects: [
                        {
                          left: 72.0,
                          top: 145.2,
                          right: 420.5,
                          bottom: 157.5,
                        },
                      ],
                    },
                  ],
                  range: [82, 173],
                },
              ],
            },
          ],
        },
        {
          type: "field-group",
          id: "question-2",
          children: [
            {
              type: "paragraph",
              children: [
                {
                  text: "Question 2: Which of the following is NOT a valid data type in most programming languages?",
                  bold: true,
                },
              ],
            },
            {
              type: "data-field",
              id: "q2-option-a",
              fieldType: "radio",
              name: "q2-answer",
              value: "a",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Integer",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q2-option-b",
              fieldType: "radio",
              name: "q2-answer",
              value: "b",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "String",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q2-option-c",
              fieldType: "radio",
              name: "q2-answer",
              value: "c",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Boolean",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q2-option-d",
              fieldType: "radio",
              name: "q2-answer",
              value: "d",
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Emotion",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "field-group",
          id: "question-3",
          children: [
            {
              type: "paragraph",
              children: [
                {
                  text: "Question 3: Which of the following are examples of control flow statements? (Select all that apply)",
                  bold: true,
                },
              ],
            },
            {
              type: "data-field",
              id: "q3-option-a",
              fieldType: "checkbox",
              name: "q3-answer-a",
              value: true,
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "if-else statements",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q3-option-b",
              fieldType: "checkbox",
              name: "q3-answer-b",
              value: true,
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Loops (for, while)",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q3-option-c",
              fieldType: "checkbox",
              name: "q3-answer-c",
              value: false,
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Variable declarations",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q3-option-d",
              fieldType: "checkbox",
              name: "q3-answer-d",
              value: true,
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Switch statements",
                    },
                  ],
                },
              ],
            },
            {
              type: "data-field",
              id: "q3-option-e",
              fieldType: "checkbox",
              name: "q3-answer-e",
              value: false,
              children: [
                {
                  type: "label",
                  labelDisplay: "right",
                  children: [
                    {
                      text: "Function calls",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "field-group",
          id: "question-4",
          children: [
            {
              type: "instructions",
              children: [
                {
                  text: "Question 4: What is the name of the programming paradigm that focuses on objects and their interactions?",
                  bold: true,
                },
              ],
            },
            {
              type: "data-field",
              id: "q4-text-answer",
              fieldType: "text",
              name: "q4-answer",
              value: "",
              children: [
                {
                  type: "label",
                  labelDisplay: "top",
                  children: [
                    {
                      text: "Your answer:",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "field-group",
          id: "question-5",
          children: [
            {
              type: "instructions",
              children: [
                {
                  text: "Question 5: Explain in your own words what a function is in programming and provide an example of when you might use one.",
                  bold: true,
                },
              ],
            },
            {
              type: "textarea",
              id: "q5-textarea-answer",
              name: "q5-answer",
              children: [
                {
                  type: "label",
                  labelDisplay: "top",
                  children: [
                    {
                      text: "Your explanation:",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          children: [
            {
              text: "Thank you for completing the quiz! Your answers have been recorded.",
            },
          ],
        },
      ],
    },
    {
      type: "h1",
      children: [{ text: "Programming Concepts Flash Cards" }],
    },
    {
      type: "paragraph",
      children: [
        {
          text: "Use these flash cards to test your knowledge of fundamental programming concepts.",
        },
      ],
    },
    {
      type: "flash-cards",
      id: "programming-concepts-deck",
      children: [
        {
          type: "flash-card",
          id: "card-1",
          children: [
            {
              type: "flash-card-front",
              children: [
                {
                  type: "h2",
                  children: [{ text: "What is a variable in programming?" }],
                },
              ],
            },
            {
              type: "flash-card-back",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      text: "A variable is a named storage location in computer memory that can hold data. It acts as a container for values that can change during program execution.",
                    },
                  ],
                },
                {
                  type: "paragraph",
                  children: [{ text: "Example: int age = 25;" }],
                },
              ],
            },
          ],
        },
        {
          type: "flash-card",
          id: "card-2",
          children: [
            {
              type: "flash-card-front",
              children: [
                {
                  type: "h2",
                  children: [{ text: "What is a function?" }],
                },
              ],
            },
            {
              type: "flash-card-back",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      text: "A function is a reusable block of code that performs a specific task. It can accept input parameters and return output values.",
                    },
                  ],
                },
                {
                  type: "paragraph",
                  children: [{ text: "Example: function add(a, b) { return a + b; }" }],
                },
              ],
            },
          ],
        },
        {
          type: "flash-card",
          id: "card-3",
          children: [
            {
              type: "flash-card-front",
              children: [
                {
                  type: "h2",
                  children: [{ text: "What is a loop?" }],
                },
              ],
            },
            {
              type: "flash-card-back",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      text: "A loop is a control structure that repeats a block of code multiple times until a certain condition is met.",
                    },
                  ],
                },
                {
                  type: "paragraph",
                  children: [{ text: "Example: for (let i = 0; i < 5; i++) { console.log(i); }" }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      children: [{
        text: "Test for acroprompt links that can be either hidden or shown as button depending on config",
      },
      {
        type: "link",
        href: "acroprompt://Expand%20on%20the%20Brachiosaurus's%20habitat%20and%20behavior",
        children: [{ text: "Expand on the Brachiosaurus's habitat and behavior" }],
      },
      {
        type: "link",
        href: "acroprompt://Develop%20a%20strategy%20for%20promoting%20dry%20farming%20in%20drought-prone%20regions.",
        children: [{ text: "Develop a strategy for promoting dry farming in drought-prone regions." }],
      },
      ],
    },
    {
      type: "column-layout",
      wrap: true,
      children: [
        {
          type: "image",
          src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAAFklEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAwG4HAAH6DloAAAAASUVORK5CYII=",
          columnWidth: "35%",
        },
        {
          type: "div",
          columnWidth: "60%",
          children: [
            {
              type: "h1",
              children: [
                {
                  text: "Welcome to the Club",
                },
              ],
            },
            {
              type: "paragraph",
              children: [
                {
                  text: "Crack open your AI-powered PDF Space, created in partnership with Reese’s Book Club.",
                },
              ],
            },
            {
              type: "paragraph",
              children: [
                {
                  text: "Here, you can: ",
                },
              ],
            },
            {
              type: "unordered-list",
              children: [
                {
                  type: "list-item",
                  children: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          text: "Discover new ways to make reading more fun",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "list-item",
                  children: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          text: "Chat with AI Assistant for tailored book picks",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "list-item",
                  children: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          text: "Get creative ideas for hosting a best-ever book club ",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "list-item",
                  children: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          text: "Connect and share the love with your favorite readers  ",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "paragraph",
              children: [
                {
                  text: "Ready to dive in? Ask AI Assistant: “What’s a thriller I won’t be able to put down?”",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "column-layout",
      wrap: true,
      children: [
        {
          type: "div",
          columnWidth: "40%",
          children: [
            {
              type: "icon",
              iconName: "ThreeStar",
              size: "S",
            },
            {
              text: "Searching web for: Carnival cruise trip packages Europe Asia",
            },
          ],
        },
        {
          type: "div",
          columnWidth: "60%",
          children: [
            {
              type: "button",
              variant: "primary",
              buttonStyle: "fill",
              children: [
                {
                  type: "icon",
                  iconName: "Bell",
                },
                {
                  text: "Notify me",
                },
              ],
              event: {
                name: "deepThinkNotify",
              },
            },
            {
              type: "button",
              variant: "secondary",
              buttonStyle: "fill",
              children: [
                {
                  type: "icon",
                  iconName: "StopCircle",
                },
                {
                  text: "Stop",
                },
              ],
              event: {
                name: "deepThinkStop",
              },
            },
          ],
        },
      ],
    },
    {
      type: "column-layout",
      children: [
        {
          type: "div",
          columnWidth: "20%",
          children: [
            {
              text: "",
            },
          ],
        },
        {
          type: "column-layout",
          columnWidth: "60%",
          wrap: true,
          children: [
            {
              type: "div",
              columnWidth: "32%",
              children: [
                {
                  type: "button",
                  variant: "secondary",
                  buttonStyle: "fill",
                  event: {
                    name: "openLink",
                    url: "https://www.carnival.com",
                  },
                  children: [
                    {
                      style: {
                        width: 16,
                        height: 16,
                        display: "inline-block",
                      },
                      type: "image",
                      src: "data:...",
                    },
                    {
                      text: "Carnival.com", bold: true,
                    },
                    {
                      text: "Carnival.com Cruises 12 day 1, Carnival.com Cruises 12 day 1",
                    },
                  ],
                },
              ],
            },
            {
              type: "div",
              columnWidth: "32%",
              children: [
                {
                  type: "button",
                  variant: "secondary",
                  buttonStyle: "fill",
                  event: {
                    name: "openLink",
                    url: "https://www.carnival.com",
                  },
                  children: [
                    {
                      style: {
                        width: 16,
                        height: 16,
                        display: "inline-block",
                      },
                      type: "image",
                      src: "data:...",
                    },
                    {
                      text: "Carnival.com", bold: true,
                    },
                    {
                      text: "Carnival.com Cruises 12 day 1",
                    },
                  ],
                },
              ],
            },
            {
              type: "div",
              columnWidth: "32%",
              children: [
                {
                  type: "button",
                  variant: "secondary",
                  buttonStyle: "fill",
                  event: {
                    name: "openLink",
                    url: "https://www.carnival.com",
                  },
                  children: [
                    {
                      style: {
                        width: 16,
                        height: 16,
                        display: "inline-block",
                      },
                      type: "image",
                      src: "data:...",
                    },
                    {
                      text: "Carnival.com", bold: true,
                    },
                    {
                      text: "Carnival.com Cruises 12 day 1",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "div",
          columnWidth: "20%",
          children: [
            {
              text: "",
            },
          ],
        },
      ],
    },
    addBlock("h2", "Disclosure (Collapsible) Elements"),
    addBlock(
      "paragraph",
      "Disclosures provide expandable/collapsible sections to organize content and reduce visual clutter.",
    ),
    {
      type: "disclosure",
      defaultExpanded: false,
      children: [
        {
          type: "disclosure-title",
          children: [{ text: "What are disclosure elements?" }],
        },
        {
          type: "disclosure-panel",
          children: [
            {
              type: "paragraph",
              children: [
                { text: "Disclosure elements (also known as collapsible sections or accordions) allow you to hide and show content on demand. They're perfect for:" },
              ],
            },
            {
              type: "unordered-list",
              children: [
                {
                  type: "list-item",
                  children: [
                    {
                      type: "div",
                      children: [{ text: "FAQ sections" }],
                    },
                  ],
                },
                {
                  type: "list-item",
                  children: [
                    {
                      type: "div",
                      children: [{ text: "Detailed technical information" }],
                    },
                  ],
                },
                {
                  type: "list-item",
                  children: [
                    {
                      type: "div",
                      children: [{ text: "Progressive disclosure of complex content" }],
                    },
                  ],
                },
                {
                  type: "list-item",
                  children: [
                    {
                      type: "div",
                      children: [{ text: "Keeping documents organized and scannable" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export default SampleNoteDoc;
