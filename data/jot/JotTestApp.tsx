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
/* eslint @typescript-eslint/no-explicit-any: "error" */
import React, { useRef } from "react";
import ReactDOM from "react-dom/client";
import { Provider, lightTheme } from "@adobe/react-spectrum";
import {
  getConfig, JotConfig, JotNoteEditor, JotDocumentEditor, JotDocument, ErrorSeverity, ErrorCode,
  MessageType, IJotRef, JotNote,
} from "../src";
import SampleContent from "./SampleContent";
import SampleNoteDoc from "./SampleNoteDoc";
import SampleChartsDoc from "./SampleCharts";
import AttributionList from "./AttributionList";
import { useReadAloud } from "./useReadAloud";
import Platform from "../src/types/Platform";
import SampleCuratedCard from "./SampleCuratedCard";

const searchParams = new URLSearchParams(window.location.search);
const enableReadAloud = searchParams.has("readAloud");
const useDoc = searchParams.has("doc");
const useCharts = searchParams.has("charts");
const useCuratedCard = searchParams.has("curated");

const config: JotConfig = getConfig({
  noteDocValidation: ErrorSeverity.ERROR,
  enableMenuBar: false,
  enableBottomFormattingBar: true,
  enableSidebar: false,
  readOnly: searchParams.has("readonly"),
  locale: searchParams.get("locale") || "en-US",
  showAttributions: true,
  showAttributionsInEditMode: true,
  // toggleChartTable: false, // Uncomment to disable chart table toggle functionality
  showAsButtonSchemesForHyperlinks: ["acroprompt"],
  enableNewLinkPopup: true,
  onLinkClick: (href: string) => {
    window.open(href, "_blank");
  },
  onError(message: string, err, severity: ErrorSeverity, errorCode: ErrorCode) {
    console.log(message, severity, errorCode);
    if (severity === ErrorSeverity.FATAL) {
      throw err;
    }
  },
  onMessage: (messageType: MessageType, message?: string, payload?: Record<string, unknown>) => {
    console.log("Message:", messageType, message, payload);
  },
});

const jotDoc: JotDocument = {
  id: "sample-note",
  contents: SampleContent.content,
  type: "document",
  schemaVersion: "0.0.1",
};

let platform: Platform = "web";
if (navigator.userAgent.includes("iPhone")) platform = "ios";
if (navigator.userAgent.includes("Android")) platform = "android";

const JotDocs = () => {
  const jotRef = useRef<IJotRef>(null);
  useReadAloud(jotRef, enableReadAloud);

  if (useCuratedCard) {
    return (
      <>
        <JotNoteEditor
          config={config}
          document={SampleCuratedCard}
          id={SampleCuratedCard.id}
        />
      </>
    );
  }

  if (useCharts) {
    return (
      <>
        <JotNoteEditor
          config={config}
          document={SampleChartsDoc}
          id={SampleChartsDoc.id}
          attributionComponent={AttributionList}
          platform={platform}
        />
      </>
    );
  }
  if (!useDoc) {
    return (
      <>
        {enableReadAloud &&
          <button id="enable-speech-button" onClick={() => jotRef.current?.switchMode("readAloud")}>Start Read Aloud</button>}

        <div style={{ position: "fixed", top: 0, right: 0, zIndex: 1000 }}>
          <button
            onClick={() => {
              if (jotRef.current) {
                jotRef.current.undo();
              }
            }}
          >
            undo
          </button>
          <button
            onClick={() => {
              if (jotRef.current) {
                jotRef.current.redo();
              }
            }}
          >
            redo
          </button>
          <button
            onClick={() => {
              if (jotRef.current) {
                jotRef.current.replaceNoteContents(SampleNoteDoc.contents);
              }
            }}
          >
            replaceNoteContents
          </button>
          <button
            onClick={() => {
              if (jotRef.current) {
                jotRef.current.emptyNoteContents();
              }
            }}
          >
            emptyNoteContents
          </button>
          <button
            onClick={() => {
              if (jotRef.current) {
                const randomNote: JotNote = {
                  id: `random-note-${Date.now()}`,
                  type: "note",
                  schemaVersion: "0.0.1",
                  contents: [
                    {
                      type: "paragraph",
                      children: [{ text: `Random content generated at ${new Date().toLocaleTimeString()}` }],
                    },
                    {
                      type: "paragraph",
                      children: [{ text: `Random number: ${Math.floor(Math.random() * 1000)}` }],
                    },
                  ],
                };
                jotRef.current.replaceNote(randomNote);
              }
            }}
          >
            replaceNote (random)
          </button>
        </div>
        <JotNoteEditor
          ref={jotRef}
          config={config}
          onChange={(noteDoc) => {
            console.log("NoteDoc changed:", noteDoc);
          }}
          document={SampleNoteDoc}
          id={SampleNoteDoc.id}
          attributionComponent={AttributionList}
        />
      </>
    );
  }
  return (
    <>
      <JotDocumentEditor
        ref={jotRef}
        config={config}
        document={jotDoc}
        id={jotDoc.id}
        attributionComponent={AttributionList}

      >
      </JotDocumentEditor>
    </>
  );
};

const ThemedDemo = () => {
  return (
    <Provider theme={lightTheme}>
      <JotDocs />
    </Provider>
  );
};

// render the demo page
const element = document.getElementById("root") || document.body;
const root = ReactDOM.createRoot(element);
root.render(<ThemedDemo />);
