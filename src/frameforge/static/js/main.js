import { connectStatusWS } from "./status.js";
import { navigate } from "./router.js";
import { startTvHealth } from "./tvhealth.js";

/* ===========================================================================
 * Bootstrap
 * ========================================================================= */

connectStatusWS();
navigate();
startTvHealth();
