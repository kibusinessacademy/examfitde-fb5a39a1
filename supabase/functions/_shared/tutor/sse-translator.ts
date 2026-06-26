/**
 * Pure SSE translator helpers for the AI Tutor.
 *
 * - Anthropic native SSE (`content_block_delta`) → OpenAI-compatible
 *   `data: {"choices":[{"delta":{"content":"..."}}]}` lines.
 * - OpenAI / OpenAI-compatible providers pass through unchanged.
 *
 * Exposed as a side-effect-free module so it can be unit-tested
 * without spinning up a network stream.
 */

export interface TranslateResult {
  /** OpenAI-compatible SSE bytes (UTF-8 string) ready to forward to the client. */
  clientChunk: string;
  /** Plain text appended to fullResponse for persistence + post-validation. */
  fullDelta: string;
}

/**
 * Translate one SSE chunk from the upstream provider into OpenAI-compatible
 * SSE for the client AND extract the plain text that should be appended to
 * `fullResponse`.
 *
 * The caller is responsible for buffering across chunk boundaries (line
 * splitting). This helper operates on already-buffered, newline-terminated
 * SSE lines.
 */
export function translateSseLine(
  line: string,
  provider: 'openai' | 'anthropic' | string,
): TranslateResult {
  if (!line.startsWith('data: ')) {
    return { clientChunk: '', fullDelta: '' };
  }
  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === '[DONE]') {
    return { clientChunk: '', fullDelta: '' };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { clientChunk: '', fullDelta: '' };
  }

  if (provider === 'anthropic') {
    if (
      parsed?.type === 'content_block_delta' &&
      parsed?.delta?.type === 'text_delta' &&
      typeof parsed.delta.text === 'string' &&
      parsed.delta.text.length > 0
    ) {
      const text: string = parsed.delta.text;
      const clientChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
      return { clientChunk, fullDelta: text };
    }
    return { clientChunk: '', fullDelta: '' };
  }

  // OpenAI-compatible passthrough — content already in expected shape.
  const content = parsed?.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content.length > 0) {
    return { clientChunk: line + '\n', fullDelta: content };
  }
  return { clientChunk: line + '\n', fullDelta: '' };
}

/**
 * Translate a full stream payload (multi-line SSE blob) and return the
 * concatenated client bytes + the assembled fullResponse text.
 */
export function translateSseStream(
  rawStream: string,
  provider: 'openai' | 'anthropic' | string,
): { clientStream: string; fullResponse: string } {
  let clientStream = '';
  let fullResponse = '';
  for (const rawLine of rawStream.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const { clientChunk, fullDelta } = translateSseLine(line, provider);
    clientStream += clientChunk;
    fullResponse += fullDelta;
  }
  if (provider === 'anthropic') {
    clientStream += 'data: [DONE]\n\n';
  }
  return { clientStream, fullResponse };
}
