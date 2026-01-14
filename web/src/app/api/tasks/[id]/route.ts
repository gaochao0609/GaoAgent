import { proxyGet } from "../../_proxy";

export const runtime = "nodejs";

const BACKEND_URL = process.env.HELLOAGENT_BACKEND_URL ?? "http://localhost:8000";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyGet(`${BACKEND_URL}/api/tasks/${encodeURIComponent(id)}`);
}
