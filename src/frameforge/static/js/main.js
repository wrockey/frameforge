import { connectStatusWS } from "./status.js";
import { navigate } from "./router.js";

/* ===========================================================================
 * Bootstrap
 * ========================================================================= */

connectStatusWS();
navigate();
