/** Same per-tab identity is used by registration and game acknowledgments. */
export function getFrontendInstanceId(): string {
  const key = "metrics-ui-frontend-instance-id";
  let id = window.sessionStorage.getItem(key);
  if (!id?.trim()) {
    id = `frontend-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(key, id);
  }
  return id;
}
