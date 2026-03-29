import { describe, expect, it } from 'vitest';

import { parseApiErrorMessage } from '../testApp/src/utils/apiErrorMessage';

describe('apiErrorMessage', () => {
  it('extracts top-level string error messages returned by the task proxy', () => {
    expect(parseApiErrorMessage(JSON.stringify({
      error: 'GEMINI_API_KEY is not configured on the proxy server.'
    }))).toBe('GEMINI_API_KEY is not configured on the proxy server.');
  });

  it('extracts structured error payloads with details', () => {
    expect(parseApiErrorMessage(JSON.stringify({
      error: {
        message: 'Bad request',
        type: 'invalid_request_error',
        code: 'bad_param'
      }
    }))).toBe('Bad request (type: invalid_request_error, code: bad_param)');
  });

  it('falls back to plain message fields', () => {
    expect(parseApiErrorMessage(JSON.stringify({
      message: 'Proxy authorization failed.'
    }))).toBe('Proxy authorization failed.');
  });
});
