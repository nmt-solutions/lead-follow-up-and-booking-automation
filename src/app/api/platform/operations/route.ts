import { getServices } from "@/server/services";
export async function GET(request: Request) {
  return (await getServices()).operationsHttp.get(request, null, true);
}
