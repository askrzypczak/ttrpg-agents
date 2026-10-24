/** Grid cells per side a token of the given size category spans. */
export function footprintForSize(size: string): number {
  switch (size) {
    case "large":
      return 2;
    case "huge":
      return 3;
    case "gargantuan":
      return 4;
    default:
      return 1;
  }
}
