export function getPath(value, path, fallback = undefined) {
  if (!path) {
    return value ?? fallback;
  }

  const segments = path.split(".");
  let current = value;
  for (const segment of segments) {
    if (current == null || !(segment in current)) {
      return fallback;
    }
    current = current[segment];
  }
  return current ?? fallback;
}

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}
