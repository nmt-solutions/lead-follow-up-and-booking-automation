import { createJsonBodyReader } from "@/http/request-body";
import { dataResponse } from "@/models/api";
import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
import { readEnvironment } from "@/server/environment";

export const runtime = "nodejs";
export const POST = (request: Request) =>
  handleRequest(async () => {
    const services = await getServices();
    const body = await createJsonBodyReader(
      new URL(readEnvironment().BETTER_AUTH_URL).origin,
      2048,
    )(request);
    return dataResponse(await services.passwords.save(request.headers, body));
  });
