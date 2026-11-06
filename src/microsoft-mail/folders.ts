import { z } from "zod";
import { MicrosoftMailFailure } from "../models/microsoft-mail";
import {
  graphMailUrl,
  microsoftValue,
  type createMicrosoftMailHttp,
} from "./http";
import { graphId } from "./messages";
const folderSchema = z.object({
  id: graphId,
  displayName: z.string().min(1).max(200),
  childFolderCount: z.number().int().min(0),
});
export async function loadMicrosoftMailFolders(
  http: ReturnType<typeof createMicrosoftMailHttp>,
  token: string,
  signal: AbortSignal,
  refs?: string[],
) {
  if (refs) {
    if (refs.length > 50) throw new MicrosoftMailFailure("unsupported_account");
    const result = [];
    for (const id of refs) {
      microsoftValue(graphId, id);
      const f = microsoftValue(
        folderSchema,
        await http.api(
          `me/mailFolders/${encodeURIComponent(id)}?$select=id,displayName,childFolderCount`,
          token,
          signal,
        ),
      );
      if (f.id !== id) throw new MicrosoftMailFailure("invalid_response");
      result.push(f);
    }
    return result;
  }
  const all: z.infer<typeof folderSchema>[] = [],
    pending = ["me/mailFolders"];
  while (pending.length) {
    const path = pending.shift()!;
    let next: string | undefined =
      `${path}?$top=50&$select=id,displayName,childFolderCount`;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new MicrosoftMailFailure("invalid_response");
      seen.add(next);
      const url = graphMailUrl(next, `/v1.0/${path}`);
      if (
        [...url.searchParams.keys()].some(
          (k) =>
            !["$select", "$top", "$skiptoken"].includes(k) ||
            url.searchParams.getAll(k).length !== 1,
        ) ||
        (url.searchParams.has("$select") &&
          url.searchParams.get("$select") !== "id,displayName,childFolderCount")
      )
        throw new MicrosoftMailFailure("invalid_response");
      const page: {
        value: z.infer<typeof folderSchema>[];
        "@odata.nextLink"?: string;
      } = microsoftValue(
        z.object({
          value: z.array(folderSchema).max(50),
          "@odata.nextLink": z.string().max(8192).optional(),
        }),
        await http.api(url.toString(), token, signal, `/v1.0/${path}`),
      );
      for (const f of page.value) {
        if (all.some((existing) => existing.id === f.id))
          throw new MicrosoftMailFailure("invalid_response");
        all.push(f);
        if (all.length > 50)
          throw new MicrosoftMailFailure("unsupported_account");
        if (f.childFolderCount)
          pending.push(
            `me/mailFolders/${encodeURIComponent(f.id)}/childFolders`,
          );
      }
      next = page["@odata.nextLink"];
    }
  }
  if (!all.length) throw new MicrosoftMailFailure("unsupported_account");
  return all;
}
