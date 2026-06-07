export function parseLinesToUniqueList(text: string): string[] {
  const unique = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim();
    if (!name) continue;
    unique.add(name);
  }
  return [...unique];
}

export function buildDuplicateName(
  baseName: string,
  existingNames: string[],
  suffixSeparator = " "
): string {
  const nameSet = new Set(existingNames.map((n) => n.trim()));
  if (!nameSet.has(baseName)) return baseName;

  let i = 2;
  while (nameSet.has(`${baseName}${suffixSeparator}${i}`)) {
    i += 1;
  }
  return `${baseName}${suffixSeparator}${i}`;
}
