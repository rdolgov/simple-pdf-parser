const NO_MATH_RESPONSE = 'NO_MATH';

export function buildMathDetectionPrompt(text: string): string {
  return `Analyze the following text from a PDF document. If it contains a mathematical formula, equation, or expression, convert it to valid LaTeX code. If it does NOT contain any math, respond with exactly "${NO_MATH_RESPONSE}".

Rules:
- Only output the LaTeX code itself, no explanations or markdown code blocks
- Use standard LaTeX math notation (e.g., \\frac{a}{b}, \\sum, \\int, x^2, etc.)
- If there are multiple formulas, combine them appropriately
- For inline math, don't add delimiters - just the LaTeX content
- If the text is clearly not mathematical (just regular text), respond with exactly "${NO_MATH_RESPONSE}"

Text to analyze:
"""
${text}
"""`;
}

export function parseMathDetectionResponse(rawText: string): string | null {
  let value = rawText.trim();
  if (!value || value.toUpperCase() === NO_MATH_RESPONSE) {
    return null;
  }

  if (value.startsWith('```')) {
    value = value.replace(/^```(?:latex)?\n?/, '').replace(/\n?```$/, '');
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
