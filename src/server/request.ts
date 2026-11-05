import "server-only";
import { createResponder } from "../http/respond";
import { reportFailure } from "./services";

export const handleRequest = createResponder(reportFailure);
