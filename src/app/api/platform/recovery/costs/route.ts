import { getServices } from "@/server/services";
export async function POST(request: Request) {
  return (await getServices()).recoveryHttp.costs(request);
}
