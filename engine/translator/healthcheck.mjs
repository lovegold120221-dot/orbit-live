const port = process.env.PORT || 8080;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3000);
try {
  const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
  clearTimeout(timer);
  process.exit(r.ok ? 0 : 1);
} catch {
  clearTimeout(timer);
  process.exit(1);
}
