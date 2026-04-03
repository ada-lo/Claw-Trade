import { createHash } from "node:crypto";

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
