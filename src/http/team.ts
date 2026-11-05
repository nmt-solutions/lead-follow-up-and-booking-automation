import type { createTeamApplication } from "../application/team";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createTeamHttp(options: {
  application: ReturnType<typeof createTeamApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const { application } = options;
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin);
  return {
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await application.getTeam(request.headers, id)),
      ),
    invite: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await application.invite(request.headers, id, await body(request)),
          201,
        ),
      ),
    accept: (request: Request) =>
      respond(async () =>
        dataResponse(
          await application.accept(request.headers, await body(request)),
        ),
      ),
    preview: (request: Request) =>
      respond(async () =>
        dataResponse(
          await application.preview(request.headers, await body(request)),
        ),
      ),
    changeRole: (request: Request, id: string) =>
      respond(async () => {
        await application.changeRole(request.headers, id, await body(request));
        return dataResponse(null);
      }),
    remove: (request: Request, id: string) =>
      respond(async () => {
        await application.removeMember(
          request.headers,
          id,
          await body(request),
        );
        return dataResponse(null);
      }),
    revoke: (request: Request, id: string) =>
      respond(async () => {
        await application.revokeInvitation(
          request.headers,
          id,
          await body(request),
        );
        return dataResponse(null);
      }),
    deliver: (request: Request, id: string) =>
      respond(async () => {
        await application.deliverInvitation(
          request.headers,
          id,
          await body(request),
        );
        return dataResponse(null);
      }),
    audit: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await application.getAudit(request.headers, id)),
      ),
    access: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await application.requireBusinessCapability(
            request.headers,
            id,
            new URL(request.url).searchParams.get("capability"),
          ),
        ),
      ),
    platformAccess: (request: Request) =>
      respond(async () =>
        dataResponse(
          await application.requirePlatformCapability(
            request.headers,
            new URL(request.url).searchParams.get("capability"),
          ),
        ),
      ),
  };
}
