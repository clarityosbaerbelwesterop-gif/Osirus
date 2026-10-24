const OWN_MODEL = /rouge|quasnir|quesnir|darus/i;

/** Own-model names are not a product. Callers render the replacement instead. */
export function mentionsOwnModel(text: string) {
  return OWN_MODEL.test(text);
}

export function withoutOwnModel(text: string) {
  return mentionsOwnModel(text) ? "Bald verfügbar" : text;
}
