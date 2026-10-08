// XMAS-30 "Contrast test and a stand-in colour table for Dawn": the WCAG 2
// contrast maths the countdown colours are held to (spec 6.6).
/** One channel of a '#rrggbb' colour, as a 0-1 number. */
function channel(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 2), 16) / 255;
}

/** WCAG 2 relative luminance of a '#rrggbb' colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = channel(hex, at);
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two '#rrggbb' colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Spec 6.6's floor for the countdown's one ink colour: WCAG AA body text. */
export const MIN_CONTRAST_RATIO = 4.5;
