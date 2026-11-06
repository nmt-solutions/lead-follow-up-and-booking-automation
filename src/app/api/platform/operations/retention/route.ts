import { getServices } from "@/server/services";
export async function POST(request: Request) {
  return (await getServices()).operationsHttp.retention(request);
}
