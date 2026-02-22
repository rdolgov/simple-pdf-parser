import { useState, useEffect, useCallback, useRef } from 'react';
import type { FocusRecording } from '../types';
import { RECORDING_STORAGE_KEY } from '../types';
import { canUseLocalStorage } from '../utils/storage';
import type { RelevanceDebugExchange } from 'pdf-layout-parser';

export interface UseRecordingsResult {
  focusRecordings: FocusRecording[];
  setFocusRecordings: React.Dispatch<React.SetStateAction<FocusRecording[]>>;
  selectedRecordingId: string | null;
  setSelectedRecordingId: (id: string | null) => void;
  recordFocusExchanges: boolean;
  setRecordFocusExchanges: (value: boolean) => void;
  useRecordingPlayback: boolean;
  setUseRecordingPlayback: (value: boolean) => void;
  focusExchangeRef: React.MutableRefObject<RelevanceDebugExchange | null>;
  handleClearRecordings: () => void;
  selectedRecording: FocusRecording | undefined;
  recordingPlaybackDisabled: boolean;
}

export function useRecordings(): UseRecordingsResult {
  const [focusRecordings, setFocusRecordings] = useState<FocusRecording[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [recordFocusExchanges, setRecordFocusExchanges] = useState(false);
  const [useRecordingPlayback, setUseRecordingPlayback] = useState(false);
  const focusExchangeRef = useRef<RelevanceDebugExchange | null>(null);

  // Load recordings from localStorage on mount
  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      const stored = window.localStorage.getItem(RECORDING_STORAGE_KEY);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored) as FocusRecording[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setFocusRecordings(parsed);
      }
    } catch (error) {
      console.warn('Failed to load focus recordings from storage', error);
    }
  }, []);

  // Persist recordings to localStorage
  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      if (focusRecordings.length === 0) {
        window.localStorage.removeItem(RECORDING_STORAGE_KEY);
      } else {
        window.localStorage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(focusRecordings));
      }
    } catch (error) {
      console.warn('Failed to persist focus recordings', error);
    }
  }, [focusRecordings]);

  const handleClearRecordings = useCallback(() => {
    setFocusRecordings([]);
    setSelectedRecordingId(null);
    setUseRecordingPlayback(false);
  }, []);

  const selectedRecording = focusRecordings.find((rec) => rec.id === selectedRecordingId);
  const recordingPlaybackDisabled = focusRecordings.length === 0 || !selectedRecordingId;

  return {
    focusRecordings,
    setFocusRecordings,
    selectedRecordingId,
    setSelectedRecordingId,
    recordFocusExchanges,
    setRecordFocusExchanges,
    useRecordingPlayback,
    setUseRecordingPlayback,
    focusExchangeRef,
    handleClearRecordings,
    selectedRecording,
    recordingPlaybackDisabled
  };
}
