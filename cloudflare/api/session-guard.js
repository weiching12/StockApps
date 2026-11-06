import { currentUser, sameOrigin as strictSameOrigin } from "../auth/session.js";
import { error } from "./http.js";

/** Same-origin signed-in session that has finished any forced password change, or the error response to return. */
export async function signedInUser(request, env) {
  if (!strictSameOrigin(request)) return { failure: error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403) };
  let user;
  try { user = await currentUser(request, env); }
  catch { return { failure: error(request, true, "AUTH_UNAVAILABLE", "帳號服務暫時無法使用", 503) }; }
  if (!user) return { failure: error(request, true, "UNAUTHENTICATED", "請先登入", 401) };
  if (user.mustChangePassword) return { failure: error(request, true, "PASSWORD_CHANGE_REQUIRED", "請先更改初始密碼", 403) };
  return { user };
}
