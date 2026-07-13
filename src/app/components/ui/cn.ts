// Tiny className combiner — joins truthy class strings. No external dep.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
