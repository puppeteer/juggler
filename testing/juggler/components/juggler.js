const {XPCOMUtils} = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
const {TCPListener} = ChromeUtils.import("chrome://juggler/content/server/server.js");
const {ChromeSession} = ChromeUtils.import("chrome://juggler/content/ChromeSession.js");
const {BrowserContextManager} = ChromeUtils.import("chrome://juggler/content/BrowserContextManager.js");
const {NetworkObserver} = ChromeUtils.import("chrome://juggler/content/NetworkObserver.js");
const {TargetRegistry} = ChromeUtils.import("chrome://juggler/content/TargetRegistry.js");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const FRAME_SCRIPT = "chrome://juggler/content/content/main.js";

// Command Line Handler
function CommandLineHandler() {
  this._port = 0;
};

CommandLineHandler.prototype = {
  classDescription: "Sample command-line handler",
  classID: Components.ID('{f7a74a33-e2ab-422d-b022-4fb213dd2639}'),
  contractID: "@mozilla.org/remote/juggler;1",
  _xpcom_categories: [{
    category: "command-line-handler",
    entry: "m-juggler"
  }],

  /* nsICommandLineHandler */
  handle: async function(cmdLine) {
    const jugglerFlag = cmdLine.handleFlagWithParam("juggler", false);
    if (!jugglerFlag || isNaN(jugglerFlag))
      return;
    this._port = parseInt(jugglerFlag, 10);
    Services.obs.addObserver(this, 'sessionstore-windows-restored');
  },

  observe: async function(subject, topic) {
    Services.obs.removeObserver(this, 'sessionstore-windows-restored');

    const win = await waitForBrowserWindow();
    const browserContextManager = new BrowserContextManager();
    const networkObserver = new NetworkObserver();
    const targetRegistry = new TargetRegistry(win, browserContextManager);

    this._server = new TCPListener();
    this._sessions = new Map();
    this._server.onconnectioncreated = connection => {
      this._sessions.set(connection, new ChromeSession(connection, browserContextManager, networkObserver, targetRegistry));
    }
    this._server.onconnectionclosed = connection => {
      const session = this._sessions.get(connection);
      this._sessions.delete(connection);
      session.dispose();
    }
    const runningPort = this._server.start(this._port);
    Services.mm.loadFrameScript(FRAME_SCRIPT, true /* aAllowDelayedLoad */);
    dump('Juggler listening on ' + runningPort + '\n');
  },

  QueryInterface: ChromeUtils.generateQI([ Ci.nsICommandLineHandler ]),

  // CHANGEME: change the help info as appropriate, but
  // follow the guidelines in nsICommandLineHandler.idl
  // specifically, flag descriptions should start at
  // character 24, and lines should be wrapped at
  // 72 characters with embedded newlines,
  // and finally, the string should end with a newline
  helpInfo : "  --juggler            Enable Juggler automation\n"
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([CommandLineHandler]);

/**
 * @return {!Promise<Ci.nsIDOMChromeWindow>}
 */
async function waitForBrowserWindow() {
  const windowsIt = Services.wm.getEnumerator('navigator:browser');
  if (windowsIt.hasMoreElements())
    return waitForWindowLoaded(windowsIt.getNext().QueryInterface(Ci.nsIDOMChromeWindow));

  let fulfill;
  let promise = new Promise(x => fulfill = x);

  const listener = {
    onOpenWindow: window => {
      if (window instanceof Ci.nsIDOMChromeWindow) {
        Services.wm.removeListener(listener);
        fulfill(waitForWindowLoaded(window));
      }
    },
    onCloseWindow: () => {}
  };
  Services.wm.addListener(listener);
  return promise;

  /**
   * @param {!Ci.nsIDOMChromeWindow} window
   * @return {!Promise<Ci.nsIDOMChromeWindow>}
   */
  function waitForWindowLoaded(window) {
    if (window.document.readyState === 'complete')
      return window;
    return new Promise(fulfill => {
      window.addEventListener('load', function listener() {
        window.removeEventListener('load', listener);
        fulfill(window);
      });
    });
  }
}
