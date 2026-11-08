/** Compatibility exports for existing Gmail composition. Both native providers use the shared locked implementation. */
export {
  nativeSequenceReplyReady as gmailSequenceReplyReady,
  nativeSendingAuthorized as gmailSendingAuthorized,
  nativeDispatchAccess as gmailDispatchAccess,
} from "./native-mail-dispatch";
