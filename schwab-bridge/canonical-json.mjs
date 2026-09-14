// Own-data-property construction preserves JSON names such as __proto__.
// Callers retain their existing JSON structural validation boundary.
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}
