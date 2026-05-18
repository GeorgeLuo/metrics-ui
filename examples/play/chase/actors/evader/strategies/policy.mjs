export function getEvaderPolicyBoolean(policy, key, fallback) {
  return typeof policy?.[key] === "boolean" ? policy[key] : fallback;
}

export function getEvaderPolicyNumber(policy, key, fallback) {
  const numericValue = Number(policy?.[key]);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}
