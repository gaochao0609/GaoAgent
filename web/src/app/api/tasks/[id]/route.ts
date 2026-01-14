import { proxyGet } from "../../_proxy";

export const runtime = "nodejs";

const BACKEND_URL = process.env.HELLOAGENT_BACKEND_URL ?? "http://localhost:8000";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = encodeURIComponent(params.id);
  return proxyGet(`${BACKEND_URL}/api/tasks/${id}`);
}
