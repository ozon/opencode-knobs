const KNOWN_DEPRECATED: Record<string, string[]> = {
  "": ["mode", "autoshare", "layout", "reference", "references"],
  AgentConfig: ["tools", "maxSteps"],
};

export function resolveRef(schema: any, defs: Record<string, any>): any {
  if (!schema?.$ref) return schema;
  const m = schema.$ref.match(/^#\/\$defs\/(.+)$/);
  if (m) return defs[m[1]] ?? schema;
  return schema;
}

export function isDeprecated(name: string, schema: any, defName = ""): boolean {
  const desc = [schema?.description, schema?.markdownDescription]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  if (/deprecat/i.test(desc)) return true;
  return (KNOWN_DEPRECATED[defName] ?? []).includes(name);
}

export function* entries(schema: any, defs: Record<string, any> = {}, defName = ""): Generator<[string, any]> {
  if (!schema?.properties) return;
  for (const [name, propSchema] of Object.entries<Record<string, any>>(schema.properties)) {
    if (name === "$schema") continue;
    if (isDeprecated(name, propSchema, defName)) continue;
    yield [name, resolveRef(propSchema, defs)];
  }
}
