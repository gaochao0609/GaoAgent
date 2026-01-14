import { proxyFormData } from "../../_proxy";

export const runtime = "nodejs";

const DEFAULT_BACKEND_URL = "http://localhost:8000/api/image/nano-banana";
const BACKEND_URL = process.env.NANO_BANANA_BACKEND_URL ?? DEFAULT_BACKEND_URL;

export async function POST(req: Request) {
  return proxyFormData(req, BACKEND_URL);
}
